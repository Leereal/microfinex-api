/**
 * MCP servers an administrator has approved.
 *
 * MCP is how other systems offer tools to an assistant - a credit bureau, a
 * payments provider, a lender's own internal service. A server is added by an
 * administrator with its address and, where needed, a header credential; the
 * credential is encrypted and never returned.
 *
 * A server's tools are offered to the model under one capability, `mcp.use`,
 * and each tool has its own setting on top of that. Anything a server returns
 * is untrusted: it is a third party's text, and it gets the same treatment as
 * an email or a web page.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { z } from 'zod';
import { prisma } from '../../../config/database';
import { encryptionService } from '../../security/encryption.service';
import { AssistantError, sanitiseToolName, untrustedEnvelope } from '../assistant.logic';
import { registerExternalTools, registerRunCleanup } from '../tools';
import type { AssistantTool, ToolContext } from '../tools/tool-kit';
import { assertBrowserUrl } from '../browser/policy';

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 60_000;

interface McpServerRow {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  authHeaderName: string | null;
  authSecret: string | null;
  toolPolicy: unknown;
  toolCache: unknown;
}

/** Live connections, one per server per run, closed when the run ends. */
const connections = new Map<string, { client: Client; serverIds: Set<string> }>();

function connectionKey(runId: string, serverId: string) {
  return `${runId}::${serverId}`;
}

async function connect(server: McpServerRow): Promise<Client> {
  // An MCP server is a URL the organization chose, so it goes through the same
  // address checks as browsing: no private addresses, no odd ports.
  await assertBrowserUrl(server.url, {
    allowedDomains: [new URL(server.url).hostname],
    allowInsecure: process.env.ASSISTANT_MCP_ALLOW_HTTP === 'true',
  });

  const headers: Record<string, string> = {};
  if (server.authHeaderName && server.authSecret) {
    headers[server.authHeaderName] = encryptionService.decrypt(server.authSecret);
  }

  const client = new Client(
    { name: 'microfinex-assistant', version: '1.0.0' },
    { capabilities: {} }
  );

  const url = new URL(server.url);
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }), {
      timeout: CONNECT_TIMEOUT_MS,
    });
  } catch {
    // Older servers only speak the SSE transport.
    await client.connect(new SSEClientTransport(url, { requestInit: { headers } }), {
      timeout: CONNECT_TIMEOUT_MS,
    });
  }
  return client;
}

async function clientFor(runId: string, server: McpServerRow): Promise<Client> {
  const key = connectionKey(runId, server.id);
  const existing = connections.get(key);
  if (existing) return existing.client;
  const client = await connect(server);
  connections.set(key, { client, serverIds: new Set([server.id]) });
  return client;
}

/** Close whatever this run opened. */
export async function closeMcpConnections(runId: string) {
  for (const [key, entry] of connections) {
    if (!key.startsWith(`${runId}::`)) continue;
    connections.delete(key);
    await entry.client.close().catch(() => undefined);
  }
}

function toolMode(server: McpServerRow, toolName: string): 'OFF' | 'ASK' | 'AUTO' {
  const policy = (server.toolPolicy ?? {}) as Record<string, string>;
  const value = policy[toolName];
  if (value === 'OFF' || value === 'AUTO' || value === 'ASK') return value;
  // A tool nobody has decided about asks. Silence is not consent.
  return 'ASK';
}

/**
 * A server's tools, as assistant tools.
 *
 * The argument schema the server publishes is JSON Schema, which is what the
 * models want anyway, so it is passed through as-is; zod is only used to keep
 * the shape of the object honest.
 */
async function toolsForServer(server: McpServerRow, ctx: ToolContext): Promise<AssistantTool[]> {
  let listed: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  try {
    const client = await clientFor(ctx.runId, server);
    const response = await client.listTools({}, { timeout: CONNECT_TIMEOUT_MS });
    listed = response.tools ?? [];
    await prisma.assistantMcpServer
      .update({
        where: { id: server.id },
        data: {
          status: 'ACTIVE',
          lastCheckedAt: new Date(),
          lastError: null,
          toolCache: listed.map(tool => ({ name: tool.name, description: tool.description ?? '' })) as never,
        },
      })
      .catch(() => undefined);
  } catch (error) {
    await prisma.assistantMcpServer
      .update({
        where: { id: server.id },
        data: { status: 'FAILED', lastCheckedAt: new Date(), lastError: (error as Error).message },
      })
      .catch(() => undefined);
    return [];
  }

  return listed
    .filter(tool => toolMode(server, tool.name) !== 'OFF')
    .map(tool => {
      const prefixed = sanitiseToolName(`mcp_${server.name.toLowerCase().replace(/\s+/g, '_')}_${tool.name}`);
      const schema = (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>;

      const assistantTool: AssistantTool = {
        name: prefixed,
        capability: 'mcp.use',
        description: `${tool.description ?? tool.name} (from ${server.name})`,
        // The server's own schema is what the model is shown; anything it sends
        // is passed straight through and validated by the server itself.
        schema: z.object({}).passthrough() as never,
        summarise: () => `${server.name}: ${tool.name}`,
        async execute(args, toolCtx) {
          const client = await clientFor(toolCtx.runId, server);
          const result = await client.callTool(
            { name: tool.name, arguments: (args ?? {}) as Record<string, unknown> },
            undefined,
            { timeout: CALL_TIMEOUT_MS }
          );
          toolCtx.markTainted();

          const text = (result.content as Array<{ type: string; text?: string }> | undefined)
            ?.filter(part => part.type === 'text')
            .map(part => part.text ?? '')
            .join('\n');

          if (result.isError) {
            throw new AssistantError(text || `${tool.name} failed on ${server.name}.`, 'MCP_TOOL_FAILED');
          }
          return {
            server: server.name,
            tool: tool.name,
            result: untrustedEnvelope(`${server.name} (MCP)`, text || JSON.stringify(result.content ?? {})),
          };
        },
      };

      // The server publishes its own argument schema; the model sees that.
      assistantTool.jsonSchema = schema;
      // A tool's own setting narrows the capability, never widens it: one set
      // to ASK asks even where mcp.use is automatic.
      assistantTool.alwaysAsk = toolMode(server, tool.name) === 'ASK';
      return assistantTool;
    });
}

/** Offer MCP tools from every enabled server. */
export function registerMcpTools() {
  registerRunCleanup(runId => closeMcpConnections(runId));
  registerExternalTools(async ctx => {
    if (ctx.clientScopeId) return [];
    const servers = await prisma.assistantMcpServer.findMany({
      where: { organizationId: ctx.organizationId, enabled: true },
    });
    const tools: AssistantTool[] = [];
    for (const server of servers) {
      tools.push(...(await toolsForServer(server as McpServerRow, ctx)));
    }
    return tools;
  });
}

// --------------------------------------------------------------- management

export interface McpContext {
  organizationId: string;
  userId: string;
}

const SERVER_FIELDS = {
  id: true,
  name: true,
  url: true,
  authHeaderName: true,
  enabled: true,
  toolPolicy: true,
  toolCache: true,
  status: true,
  lastCheckedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const;

class McpServerService {
  async list(ctx: McpContext) {
    const servers = await prisma.assistantMcpServer.findMany({
      where: { organizationId: ctx.organizationId },
      select: SERVER_FIELDS,
      orderBy: { name: 'asc' },
    });
    return { servers, encryptedAtRest: encryptionService.isEnabled() };
  }

  async create(
    ctx: McpContext,
    input: { name: string; url: string; authHeaderName?: string; authSecret?: string; enabled?: boolean }
  ) {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new AssistantError('That is not a valid server address.', 'INVALID_URL');
    }
    if (url.protocol !== 'https:' && process.env.ASSISTANT_MCP_ALLOW_HTTP !== 'true') {
      throw new AssistantError('An MCP server must be reached over https.', 'INSECURE_URL');
    }

    return prisma.assistantMcpServer.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name.slice(0, 80),
        url: input.url,
        authHeaderName: input.authHeaderName?.slice(0, 80) ?? null,
        authSecret: input.authSecret
          ? encryptionService.encrypt(input.authSecret, { organizationId: ctx.organizationId })
          : null,
        enabled: input.enabled ?? false,
        createdById: ctx.userId,
      },
      select: SERVER_FIELDS,
    });
  }

  async update(
    ctx: McpContext,
    id: string,
    input: {
      name?: string;
      url?: string;
      authHeaderName?: string | null;
      authSecret?: string | null;
      enabled?: boolean;
      toolPolicy?: Record<string, string>;
    }
  ) {
    const existing = await prisma.assistantMcpServer.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!existing) throw new AssistantError('No such server.', 'NOT_FOUND', 404);

    const policy = input.toolPolicy
      ? Object.fromEntries(
          Object.entries(input.toolPolicy).filter(([, value]) => ['OFF', 'ASK', 'AUTO'].includes(value))
        )
      : undefined;

    return prisma.assistantMcpServer.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.slice(0, 80) } : {}),
        ...(input.url !== undefined ? { url: input.url, status: 'UNVERIFIED' } : {}),
        ...(input.authHeaderName !== undefined ? { authHeaderName: input.authHeaderName } : {}),
        ...(input.authSecret !== undefined
          ? {
              authSecret: input.authSecret
                ? encryptionService.encrypt(input.authSecret, { organizationId: ctx.organizationId })
                : null,
            }
          : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(policy ? { toolPolicy: policy as never } : {}),
      },
      select: SERVER_FIELDS,
    });
  }

  async remove(ctx: McpContext, id: string) {
    const existing = await prisma.assistantMcpServer.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!existing) throw new AssistantError('No such server.', 'NOT_FOUND', 404);
    await prisma.assistantMcpServer.delete({ where: { id } });
    return { removed: true };
  }

  /** Connect once and list the tools, so an administrator can set a policy. */
  async test(ctx: McpContext, id: string) {
    const server = await prisma.assistantMcpServer.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!server) throw new AssistantError('No such server.', 'NOT_FOUND', 404);

    const runId = `mcp-test:${id}:${Date.now()}`;
    try {
      const client = await clientFor(runId, server as McpServerRow);
      const response = await client.listTools({}, { timeout: CONNECT_TIMEOUT_MS });
      const tools = (response.tools ?? []).map(tool => ({
        name: tool.name,
        description: tool.description ?? '',
      }));
      await prisma.assistantMcpServer.update({
        where: { id },
        data: { status: 'ACTIVE', lastCheckedAt: new Date(), lastError: null, toolCache: tools as never },
      });
      return { reachable: true, tools };
    } catch (error) {
      const message = (error as Error).message;
      await prisma.assistantMcpServer.update({
        where: { id },
        data: { status: 'FAILED', lastCheckedAt: new Date(), lastError: message },
      });
      return { reachable: false, error: message, tools: [] };
    } finally {
      await closeMcpConnections(runId);
    }
  }
}

export const mcpServerService = new McpServerService();
