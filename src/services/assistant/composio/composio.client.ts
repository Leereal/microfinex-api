/**
 * Composio, over its REST API.
 *
 * Composio holds the OAuth tokens for a lender's mailbox and other accounts,
 * so this system never sees a Google or Microsoft password. We talk to it with
 * plain HTTP rather than its SDK: the SDK is ESM-only and this API is
 * CommonJS, and the handful of endpoints used here are stable.
 *
 * One Composio "user" is created per connected account rather than per
 * organization, so a lender can connect two mailboxes without the second
 * displacing the first, and disconnecting one never touches the other.
 *
 * Configuration:
 *   COMPOSIO_API_KEY        the lender platform's own Composio key
 *   COMPOSIO_WEBHOOK_SECRET verifies pushes from Composio
 *   API_PUBLIC_URL          where Composio should send the browser back
 */

import crypto from 'crypto';
import { AssistantError } from '../assistant.logic';

const BASE_URL = (process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev/api/v3').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 30_000;

export interface ComposioToolkit {
  slug: string;
  name: string;
  /** What the assistant uses it for, in the settings screen. */
  purpose: string;
}

/**
 * The accounts an organization may connect.
 *
 * Mail comes first because everything the assistant does with email - intake,
 * filing correspondence, replying - runs through it. The rest are offered but
 * start switched off, under the "other connected apps" capability.
 */
export const SUPPORTED_TOOLKITS: ComposioToolkit[] = [
  { slug: 'gmail', name: 'Gmail', purpose: 'Read applications and client correspondence, and reply' },
  { slug: 'outlook', name: 'Microsoft Outlook', purpose: 'Read applications and client correspondence, and reply' },
  { slug: 'googledrive', name: 'Google Drive', purpose: 'Fetch documents a client has shared' },
  { slug: 'googlecalendar', name: 'Google Calendar', purpose: 'Check and book appointments' },
  { slug: 'slack', name: 'Slack', purpose: 'Post updates to your team' },
];

export const MAIL_TOOLKITS = ['gmail', 'outlook'];

export function isComposioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

function apiKey(): string {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) {
    throw new AssistantError(
      'Composio is not set up on this server, so accounts cannot be connected. Ask your administrator to add COMPOSIO_API_KEY.',
      'COMPOSIO_NOT_CONFIGURED',
      503
    );
  }
  return key;
}

export function publicBaseUrl(): string {
  return (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 8000}`).replace(/\/+$/, '');
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) url.searchParams.append(key, entry);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'x-api-key': apiKey(),
        'content-type': 'application/json',
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AssistantError(
      `Composio could not be reached: ${(error as Error).message}`,
      'COMPOSIO_UNREACHABLE',
      502
    );
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string }; message?: string } | null)?.error?.message ??
      (payload as { message?: string } | null)?.message ??
      `Composio returned ${response.status}`;
    throw new AssistantError(message, 'COMPOSIO_ERROR', response.status === 404 ? 404 : 502);
  }

  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export interface ConnectLink {
  redirectUrl: string;
  connectedAccountId: string | null;
  expiresAt: string | null;
}

export interface ComposioAccount {
  id: string;
  status: string;
  toolkitSlug: string | null;
  userId: string | null;
  /** The address or account name, where the provider tells us. */
  label: string | null;
}

class ComposioClient {
  /**
   * The auth config for a toolkit, created on first use.
   *
   * Composio's own OAuth app is used ("managed auth"), so a lender connects a
   * mailbox by signing in, with nothing to register at Google or Microsoft.
   */
  async ensureAuthConfig(toolkit: string): Promise<string> {
    const existing = await request<{ items?: Array<{ id: string; is_composio_managed?: boolean }> }>(
      '/auth_configs',
      { query: { toolkit_slug: toolkit, limit: '20' } }
    ).catch(() => ({ items: [] }));

    const managed = existing.items?.find(item => item.is_composio_managed !== false);
    if (managed?.id) return managed.id;

    const created = await request<{ auth_config?: { id: string }; id?: string }>('/auth_configs', {
      method: 'POST',
      body: {
        toolkit: { slug: toolkit },
        auth_config: { type: 'use_composio_managed_auth', credentials: {} },
      },
    });
    const id = created.auth_config?.id ?? created.id;
    if (!id) throw new AssistantError('Composio did not return an auth configuration.', 'COMPOSIO_ERROR', 502);
    return id;
  }

  /** The link the person follows to sign in to their mailbox. */
  async createConnectLink(input: {
    authConfigId: string;
    composioUserId: string;
    callbackUrl: string;
  }): Promise<ConnectLink> {
    const response = await request<{
      redirect_url?: string;
      redirectUrl?: string;
      connected_account_id?: string;
      id?: string;
      expires_at?: string;
    }>('/connected_accounts/link', {
      method: 'POST',
      body: {
        auth_config_id: input.authConfigId,
        user_id: input.composioUserId,
        callback_url: input.callbackUrl,
      },
    });

    const redirectUrl = response.redirect_url ?? response.redirectUrl;
    if (!redirectUrl) {
      throw new AssistantError('Composio did not return a sign-in link.', 'COMPOSIO_ERROR', 502);
    }
    return {
      redirectUrl,
      connectedAccountId: response.connected_account_id ?? response.id ?? null,
      expiresAt: response.expires_at ?? null,
    };
  }

  /** What Composio currently thinks of an account. */
  async getAccount(accountId: string): Promise<ComposioAccount | null> {
    const account = await request<Record<string, unknown>>(`/connected_accounts/${accountId}`).catch(() => null);
    if (!account) return null;
    return normaliseAccount(account);
  }

  async listAccounts(composioUserId: string): Promise<ComposioAccount[]> {
    const response = await request<{ items?: Array<Record<string, unknown>> }>('/connected_accounts', {
      query: { user_ids: composioUserId, limit: '20' },
    }).catch(() => ({ items: [] }));
    return (response.items ?? []).map(normaliseAccount);
  }

  async deleteAccount(accountId: string): Promise<void> {
    await request(`/connected_accounts/${accountId}`, { method: 'DELETE' }).catch(error => {
      // Disconnecting locally should still succeed if Composio has already
      // forgotten the account.
      console.warn('Composio delete failed:', (error as Error).message);
    });
  }

  /**
   * Run one of the connected account's tools.
   *
   * Composio answers with { data, error, successful }: a tool that failed is
   * reported in the body rather than by status, so both are checked.
   */
  async executeTool(input: {
    slug: string;
    connectedAccountId: string;
    composioUserId: string;
    arguments: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const response = await request<{
      data?: Record<string, unknown>;
      error?: unknown;
      successful?: boolean;
    }>(`/tools/execute/${encodeURIComponent(input.slug)}`, {
      method: 'POST',
      body: {
        connected_account_id: input.connectedAccountId,
        user_id: input.composioUserId,
        arguments: input.arguments,
      },
    });

    if (response.successful === false || response.error) {
      const message =
        typeof response.error === 'string'
          ? response.error
          : ((response.error as { message?: string } | undefined)?.message ?? `${input.slug} failed`);
      throw new AssistantError(message, 'COMPOSIO_TOOL_FAILED', 502);
    }
    return response.data ?? {};
  }

  /** The tools a toolkit offers, for the settings screen and the model. */
  async listTools(toolkit: string): Promise<Array<{ slug: string; name: string; description: string; inputParameters: unknown }>> {
    const response = await request<{ items?: Array<Record<string, unknown>> }>('/tools', {
      query: { toolkit_slug: toolkit, limit: '100' },
    });
    return (response.items ?? []).map(item => ({
      slug: String(item.slug ?? ''),
      name: String(item.name ?? item.slug ?? ''),
      description: String(item.description ?? ''),
      inputParameters: item.input_parameters ?? null,
    }));
  }

  /**
   * Ask Composio to tell us when new mail arrives.
   *
   * Polling still runs regardless: a trigger that cannot be created - because
   * the plan does not allow it, or the slug has changed - leaves the automation
   * working, just a few minutes slower.
   */
  async upsertTrigger(input: {
    slug: string;
    connectedAccountId: string;
    config: Record<string, unknown>;
  }): Promise<string | null> {
    const response = await request<{ trigger_id?: string; id?: string }>(
      `/trigger_instances/${encodeURIComponent(input.slug)}/upsert`,
      {
        method: 'POST',
        body: { connected_account_id: input.connectedAccountId, trigger_config: input.config },
      }
    ).catch(error => {
      console.warn('Composio trigger not created:', (error as Error).message);
      return null;
    });
    return response?.trigger_id ?? response?.id ?? null;
  }

  async deleteTrigger(triggerId: string): Promise<void> {
    await request(`/trigger_instances/manage/${encodeURIComponent(triggerId)}`, { method: 'DELETE' }).catch(
      error => console.warn('Composio trigger not removed:', (error as Error).message)
    );
  }
}

function normaliseAccount(account: Record<string, unknown>): ComposioAccount {
  const data = (account.data ?? {}) as Record<string, unknown>;
  const toolkit = account.toolkit as { slug?: string } | undefined;
  return {
    id: String(account.id ?? ''),
    status: String(account.status ?? 'UNKNOWN').toUpperCase(),
    toolkitSlug: toolkit?.slug ? String(toolkit.slug) : (account.toolkit_slug as string) ?? null,
    userId: (account.user_id as string) ?? null,
    label:
      (data.email as string) ??
      (data.emailAddress as string) ??
      (data.user_email as string) ??
      (account.name as string) ??
      null,
  };
}

/**
 * Check that a webhook really came from Composio.
 *
 * Composio signs `id.timestamp.body` with the webhook secret; the signature
 * header carries a version and the signature itself. Compared in constant time,
 * and refused outright when no secret is configured - an unverified webhook
 * that files mail against clients is worse than no webhook at all.
 */
export function verifyComposioWebhook(input: {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: Buffer | undefined;
}): { ok: boolean; reason?: string } {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'COMPOSIO_WEBHOOK_SECRET is not configured' };
  if (!input.id || !input.timestamp || !input.signature || !input.rawBody) {
    return { ok: false, reason: 'The webhook headers are incomplete' };
  }

  // Older than five minutes: refuse, so a captured request cannot be replayed.
  const sentAt = Number(input.timestamp) * (input.timestamp.length > 11 ? 1 : 1000);
  if (Number.isFinite(sentAt) && Math.abs(Date.now() - sentAt) > 5 * 60_000) {
    return { ok: false, reason: 'The webhook is too old' };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${input.id}.${input.timestamp}.${input.rawBody.toString('utf8')}`)
    .digest('base64');

  const provided = input.signature.includes(',') ? input.signature.split(',')[1]! : input.signature;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return { ok: false, reason: 'The signature does not match' };
  return crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'The signature does not match' };
}

export const composioClient = new ComposioClient();
