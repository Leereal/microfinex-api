/**
 * Plain HTTP APIs the organization has configured.
 *
 * Not every service speaks MCP. A lender may have a bureau, a payments
 * gateway or an internal service with an ordinary REST API, and this lets an
 * administrator describe one once - base address, how it authenticates, and
 * whether anything other than GET is allowed - so the assistant can call it
 * without ever holding the credential.
 *
 * The credential is encrypted, attached by the server at the moment of the
 * call, and never appears in the transcript, a tool result or a log line.
 * Reading is one capability and writing another, and both start switched off.
 */

import { z } from 'zod';
import { prisma } from '../../../config/database';
import { encryptionService } from '../../security/encryption.service';
import { createAuditLog } from '../../audit.service';
import { AssistantError, truncate, untrustedEnvelope } from '../assistant.logic';
import { registerExternalTools } from '../tools';
import type { AssistantTool } from '../tools/tool-kit';
import { assertBrowserUrl } from '../browser/policy';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 20_000;

export interface ConnectorContext {
  organizationId: string;
  userId: string;
}

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  description: true,
  baseUrl: true,
  authType: true,
  authHeaderName: true,
  allowWrite: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** The headers this connector adds, built fresh for each call. */
function authHeaders(connector: {
  authType: string;
  authHeaderName: string | null;
  secret: string | null;
}): Record<string, string> {
  if (!connector.secret || connector.authType === 'NONE') return {};
  const secret = encryptionService.decrypt(connector.secret);
  switch (connector.authType) {
    case 'BEARER':
      return { authorization: `Bearer ${secret}` };
    case 'BASIC':
      return { authorization: `Basic ${Buffer.from(secret).toString('base64')}` };
    case 'HEADER':
      return connector.authHeaderName ? { [connector.authHeaderName]: secret } : {};
    default:
      return {};
  }
}

export function connectorTools(): AssistantTool[] {
  return [
    {
      name: 'list_api_connectors',
      capability: 'api.read',
      description: 'The APIs your organization has configured, with what each one is for.',
      schema: z.object({}),
      summarise: () => 'List the connected APIs',
      async execute(_args, ctx) {
        const connectors = await prisma.assistantApiConnector.findMany({
          where: { organizationId: ctx.organizationId, enabled: true },
          select: { id: true, name: true, description: true, baseUrl: true, allowWrite: true },
        });
        return { connectors };
      },
    },

    {
      name: 'call_api',
      capability: 'api.read',
      description:
        'Call a configured API. Use list_api_connectors first to find its id. Only GET is allowed unless the connector permits more.',
      schema: z.object({
        connectorId: z.string().uuid(),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
        path: z.string().max(500).describe('The path under the base address, for example /v1/checks/12345'),
        query: z.record(z.string()).optional(),
        body: z.unknown().optional().describe('JSON body, for methods that take one'),
      }),
      editableFields: ['path', 'query', 'body'],
      summarise: args => `${args.method ?? 'GET'} ${args.path}`,
      async execute(args, ctx) {
        const connector = await prisma.assistantApiConnector.findFirst({
          where: { id: args.connectorId, organizationId: ctx.organizationId, enabled: true },
        });
        if (!connector) throw new AssistantError('No such API connector.', 'NOT_FOUND', 404);

        const method = (args.method ?? 'GET').toUpperCase();
        if (method !== 'GET' && !connector.allowWrite) {
          throw new AssistantError(
            `${connector.name} is read-only. Only GET requests are allowed to it.`,
            'WRITE_NOT_ALLOWED',
            403
          );
        }

        const base = new URL(connector.baseUrl);
        const url = new URL(args.path.replace(/^\/+/, ''), base.toString().endsWith('/') ? base : new URL(`${base}/`));
        // The path may not climb out of the configured service.
        if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname.replace(/\/+$/, ''))) {
          throw new AssistantError('That path is outside this connector’s address.', 'PATH_NOT_ALLOWED');
        }
        for (const [key, value] of Object.entries(args.query ?? {})) url.searchParams.append(key, String(value));

        await assertBrowserUrl(url.toString(), { allowedDomains: [base.hostname] });

        const response = await fetch(url, {
          method,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...authHeaders(connector),
          },
          ...(method !== 'GET' && args.body !== undefined ? { body: JSON.stringify(args.body) } : {}),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }).catch(error => {
          throw new AssistantError(`${connector.name} could not be reached: ${error.message}`, 'API_UNREACHABLE', 502);
        });

        const text = await response.text();
        ctx.markTainted();

        return {
          status: response.status,
          ok: response.ok,
          body: untrustedEnvelope(`${connector.name} API`, truncate(text, MAX_RESPONSE_CHARS)),
        };
      },
    },
  ];
}

export function registerConnectorTools() {
  registerExternalTools(async ctx => {
    if (ctx.clientScopeId) return [];
    const count = await prisma.assistantApiConnector.count({
      where: { organizationId: ctx.organizationId, enabled: true },
    });
    if (count === 0) return [];

    const tools = connectorTools();
    // A write needs its own capability, so the calling tool is offered twice:
    // once as a read, once as a write the settings can allow separately.
    const writeTool = tools.find(tool => tool.name === 'call_api');
    if (writeTool) {
      tools.push({
        ...writeTool,
        name: 'call_api_write',
        capability: 'api.write',
        description:
          'Send data to a configured API (POST, PUT, PATCH or DELETE). Only works where the connector allows it.',
      });
    }
    return tools;
  });
}

class ApiConnectorService {
  async list(ctx: ConnectorContext) {
    const connectors = await prisma.assistantApiConnector.findMany({
      where: { organizationId: ctx.organizationId },
      select: PUBLIC_FIELDS,
      orderBy: { name: 'asc' },
    });
    return { connectors, encryptedAtRest: encryptionService.isEnabled() };
  }

  async create(
    ctx: ConnectorContext,
    input: {
      name: string;
      baseUrl: string;
      description?: string;
      authType?: 'NONE' | 'BEARER' | 'HEADER' | 'BASIC';
      authHeaderName?: string;
      secret?: string;
      allowWrite?: boolean;
      enabled?: boolean;
    }
  ) {
    let url: URL;
    try {
      url = new URL(input.baseUrl);
    } catch {
      throw new AssistantError('That is not a valid web address.', 'INVALID_URL');
    }
    if (url.protocol !== 'https:') {
      throw new AssistantError('An API must be reached over https.', 'INSECURE_URL');
    }
    const authType = input.authType ?? 'NONE';
    if (authType === 'HEADER' && !input.authHeaderName) {
      throw new AssistantError('Name the header the credential goes in.', 'HEADER_NAME_REQUIRED');
    }
    if (authType !== 'NONE' && !input.secret) {
      throw new AssistantError('A credential is needed for that kind of authentication.', 'SECRET_REQUIRED');
    }

    const connector = await prisma.assistantApiConnector.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name.slice(0, 80),
        description: input.description?.slice(0, 500) ?? null,
        baseUrl: input.baseUrl,
        authType,
        authHeaderName: input.authHeaderName ?? null,
        secret: input.secret
          ? encryptionService.encrypt(input.secret, { organizationId: ctx.organizationId })
          : null,
        allowWrite: input.allowWrite ?? false,
        enabled: input.enabled ?? true,
        createdById: ctx.userId,
      },
      select: PUBLIC_FIELDS,
    });

    await createAuditLog({
      action: 'CREATE',
      resource: 'ASSISTANT_API_CONNECTOR',
      resourceId: connector.id,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      newValue: { name: connector.name, baseUrl: connector.baseUrl, allowWrite: connector.allowWrite },
    }).catch(() => undefined);

    return connector;
  }

  async update(
    ctx: ConnectorContext,
    id: string,
    input: {
      name?: string;
      description?: string | null;
      baseUrl?: string;
      authType?: 'NONE' | 'BEARER' | 'HEADER' | 'BASIC';
      authHeaderName?: string | null;
      secret?: string | null;
      allowWrite?: boolean;
      enabled?: boolean;
    }
  ) {
    const existing = await prisma.assistantApiConnector.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!existing) throw new AssistantError('No such connector.', 'NOT_FOUND', 404);

    if (input.baseUrl) {
      try {
        const url = new URL(input.baseUrl);
        if (url.protocol !== 'https:') throw new Error('insecure');
      } catch {
        throw new AssistantError('The base address must be a valid https address.', 'INVALID_URL');
      }
    }

    return prisma.assistantApiConnector.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.slice(0, 80) } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.authType !== undefined ? { authType: input.authType } : {}),
        ...(input.authHeaderName !== undefined ? { authHeaderName: input.authHeaderName } : {}),
        ...(input.secret !== undefined
          ? {
              secret: input.secret
                ? encryptionService.encrypt(input.secret, { organizationId: ctx.organizationId })
                : null,
            }
          : {}),
        ...(input.allowWrite !== undefined ? { allowWrite: input.allowWrite } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
      select: PUBLIC_FIELDS,
    });
  }

  async remove(ctx: ConnectorContext, id: string) {
    const existing = await prisma.assistantApiConnector.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!existing) throw new AssistantError('No such connector.', 'NOT_FOUND', 404);
    await prisma.assistantApiConnector.delete({ where: { id } });
    return { removed: true };
  }

  /** A GET against the base address, to check the credential works. */
  async test(ctx: ConnectorContext, id: string, path = '/') {
    const connector = await prisma.assistantApiConnector.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!connector) throw new AssistantError('No such connector.', 'NOT_FOUND', 404);

    const base = new URL(connector.baseUrl);
    const url = new URL(path.replace(/^\/+/, ''), base.toString().endsWith('/') ? base : new URL(`${base}/`));
    await assertBrowserUrl(url.toString(), { allowedDomains: [base.hostname] });

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', ...authHeaders(connector) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      return { reachable: true, status: response.status, sample: truncate(text, 500) };
    } catch (error) {
      return { reachable: false, error: (error as Error).message };
    }
  }
}

export const apiConnectorService = new ApiConnectorService();
