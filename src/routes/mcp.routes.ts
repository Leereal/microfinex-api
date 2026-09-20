/**
 * Microfinex as an MCP server.
 *
 *   POST /mcp     the Streamable HTTP endpoint other assistants connect to
 *
 * This is the other direction from the assistant's own MCP client: it lets a
 * tool somebody already uses - Claude, an internal agent, a colleague's editor
 * - read this system's records, with the same authority the person signing in
 * has and nothing more.
 *
 * Read-only by design. Creating clients, starting applications and messaging
 * borrowers all belong to the assistant inside the system, where the approval
 * trail and the audit log live; an outside client gets the reading half.
 *
 * Each request is handled on its own transport, with no session kept between
 * them, so several instances can serve the same caller without sharing state.
 */

import { Router, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { loadPermissions } from '../middleware/permissions';
import { loadUserPermissions } from '../middleware/permissions';
import { prisma } from '../config/database';
import { brandName } from '../services/branding/branding.cache';
import { assistantSettingsService } from '../services/assistant/assistant.settings.service';
import { resolveCapabilityMode } from '../services/assistant/assistant.logic';
import { readTools } from '../services/assistant/tools/read.tools';
import type { ToolContext } from '../services/assistant/tools/tool-kit';

/** The SDK's registerTool, with its generics stood down. */
type RegisterTool = (
  name: string,
  config: { description: string; inputSchema: Record<string, unknown> },
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>
) => void;

const router = Router();

/** Reading tools this caller is allowed, as MCP tools. */
async function buildServer(ctx: {
  organizationId: string;
  userId: string;
}): Promise<McpServer> {
  const [settings, permissions, user] = await Promise.all([
    assistantSettingsService.resolve(ctx.organizationId),
    loadUserPermissions(ctx.userId),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { branchId: true } }),
  ]);

  const server = new McpServer({ name: `${brandName()} MCP`, version: '1.0.0' });

  const toolCtx: ToolContext = {
    organizationId: ctx.organizationId,
    actingUserId: ctx.userId,
    permissions,
    settings,
    runId: `mcp:${Date.now()}`,
    conversationId: null,
    branchId: user?.branchId ?? null,
    clientScopeId: null,
    markTainted: () => undefined,
    artifactIds: [],
  };

  for (const tool of readTools) {
    const mode = resolveCapabilityMode(settings.capabilities, tool.capability);
    if (mode === 'OFF') continue;

    // The caller's own permissions decide, exactly as they do in the app: the
    // tools read them out of the context below.
    const shape = (tool.schema as z.ZodObject<z.ZodRawShape>).shape ?? {};

    // The shapes are only known at runtime, so the SDK's generic inference is
    // sidestepped here; the tool validates its own arguments when it runs.
    (server.registerTool as unknown as RegisterTool)(
      tool.name,
      { description: tool.description, inputSchema: shape },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.execute(args, toolCtx);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: (error as Error).message }],
          };
        }
      }
    );
  }

  return server;
}

/**
 * One request, one transport.
 *
 * The SDK's stateless mode is used deliberately: a session held in memory
 * would break the moment a second API instance answered the next request.
 */
async function handle(req: Request, res: Response) {
  const user = req.user as unknown as { id?: string; userId?: string; organizationId?: string };
  const userId = user?.id || user?.userId;
  if (!user?.organizationId || !userId) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Organization context required' },
      id: null,
    });
    return;
  }

  const permissions = await loadUserPermissions(userId);
  if (!permissions.has('assistant:use')) {
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'You do not have permission to use the assistant' },
      id: null,
    });
    return;
  }

  const settings = await assistantSettingsService.resolve(user.organizationId);
  if (!settings.enabled) {
    res.status(409).json({
      jsonrpc: '2.0',
      error: { code: -32002, message: 'The Agentic Assistant is switched off for this organization' },
      id: null,
    });
    return;
  }

  const server = await buildServer({ organizationId: user.organizationId, userId });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

router.post('/', authenticate, loadPermissions, (req, res) => {
  handle(req, res).catch(error => {
    console.error('MCP request failed:', (error as Error).message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      });
    }
  });
});

// Without a session there is nothing to stream or to end, so the other two
// methods say so rather than failing obscurely.
router.get('/', (_req, res) =>
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'This server does not keep sessions; send requests with POST.' },
    id: null,
  })
);
router.delete('/', (_req, res) =>
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'This server does not keep sessions.' },
    id: null,
  })
);

export default router;
