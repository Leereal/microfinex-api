/**
 * The organization's assistant settings: whether it is on, what it may do
 * unattended, which model it uses and what it is allowed to cost.
 *
 * Settings are read on every run and on every tool call, so they are cached
 * briefly. Anything that changes them clears the cache for that organization,
 * so turning the assistant off takes effect at once rather than a minute later.
 */

import { prisma } from '../../config/database';
import { createAuditLog } from '../audit.service';
import {
  AssistantError,
  CAPABILITIES,
  HUMAN_ONLY_ACTIONS,
  type AutonomyMode,
  type WorkingHours,
  defaultCapabilityModes,
  parseWorkingHours,
  resolveCapabilityModes,
  sanitiseCapabilityModes,
} from './assistant.logic';

export interface WhatsAppAssistantConfig {
  /** Ask the caller to confirm who they are before sharing account details. */
  requireVerification: boolean;
  greeting: string | null;
  /** Replies the assistant may send to one client in an hour. */
  hourlyReplyLimit: number;
  /** How long a handover to a person silences the assistant, in hours. */
  handoffHours: number;
}

export interface ResolvedAssistantSettings {
  organizationId: string;
  enabled: boolean;
  providerName: string | null;
  modelName: string | null;
  capabilities: Record<string, AutonomyMode>;
  instructions: string | null;
  maxStepsPerRun: number;
  monthlyTokenBudget: number | null;
  dailyRunLimit: number;
  timezone: string;
  workingHours: WorkingHours | null;
  memoryEnabled: boolean;
  whatsappEnabled: boolean;
  whatsapp: WhatsAppAssistantConfig;
  browserAllowedDomains: string[];
}

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppAssistantConfig = {
  requireVerification: true,
  greeting: null,
  hourlyReplyLimit: 12,
  handoffHours: 4,
};

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: ResolvedAssistantSettings; at: number }>();

function parseWhatsApp(input: unknown): WhatsAppAssistantConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const hourly = Number(raw.hourlyReplyLimit);
  const handoff = Number(raw.handoffHours);
  return {
    requireVerification: raw.requireVerification === undefined ? true : raw.requireVerification !== false,
    greeting: typeof raw.greeting === 'string' && raw.greeting.trim() ? raw.greeting.trim() : null,
    hourlyReplyLimit: Number.isFinite(hourly) && hourly > 0 && hourly <= 60 ? Math.round(hourly) : DEFAULT_WHATSAPP_CONFIG.hourlyReplyLimit,
    handoffHours: Number.isFinite(handoff) && handoff > 0 && handoff <= 72 ? Math.round(handoff) : DEFAULT_WHATSAPP_CONFIG.handoffHours,
  };
}

export interface UpdateSettingsInput {
  enabled?: boolean;
  providerName?: string | null;
  modelName?: string | null;
  capabilities?: Record<string, string>;
  instructions?: string | null;
  maxStepsPerRun?: number;
  monthlyTokenBudget?: number | null;
  dailyRunLimit?: number;
  timezone?: string;
  workingHours?: unknown;
  memoryEnabled?: boolean;
  whatsappEnabled?: boolean;
  whatsappConfig?: unknown;
  browserAllowedDomains?: string[];
}

class AssistantSettingsService {
  /** Forget what was cached for an organization - or for all of them. */
  clearCache(organizationId?: string) {
    if (organizationId) cache.delete(organizationId);
    else cache.clear();
  }

  /**
   * The settings in force, with every unset value filled in.
   *
   * An organization that has never opened the settings screen still gets a
   * complete answer: off, with the default autonomy for each capability.
   */
  async resolve(organizationId: string): Promise<ResolvedAssistantSettings> {
    const cached = cache.get(organizationId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const row = await prisma.assistantSettings.findUnique({ where: { organizationId } });

    const value: ResolvedAssistantSettings = {
      organizationId,
      enabled: row?.enabled ?? false,
      providerName: row?.providerName ?? null,
      modelName: row?.modelName ?? null,
      capabilities: row ? resolveCapabilityModes(row.capabilities) : defaultCapabilityModes(),
      instructions: row?.instructions ?? null,
      maxStepsPerRun: row?.maxStepsPerRun ?? 12,
      monthlyTokenBudget: row?.monthlyTokenBudget ?? null,
      dailyRunLimit: row?.dailyRunLimit ?? 200,
      timezone: row?.timezone ?? 'Africa/Harare',
      workingHours: parseWorkingHours(row?.workingHours),
      memoryEnabled: row?.memoryEnabled ?? true,
      whatsappEnabled: row?.whatsappEnabled ?? false,
      whatsapp: parseWhatsApp(row?.whatsappConfig),
      browserAllowedDomains: row?.browserAllowedDomains ?? [],
    };

    cache.set(organizationId, { value, at: Date.now() });
    return value;
  }

  /** The settings as the settings screen shows them, with the catalogue. */
  async forDisplay(organizationId: string) {
    const settings = await this.resolve(organizationId);
    return {
      settings,
      catalogue: CAPABILITIES,
      humanOnly: HUMAN_ONLY_ACTIONS,
    };
  }

  async update(
    ctx: { organizationId: string; userId: string },
    input: UpdateSettingsInput
  ): Promise<ResolvedAssistantSettings> {
    const existing = await prisma.assistantSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    });

    const data: Record<string, unknown> = {};
    if (input.enabled !== undefined) data.enabled = Boolean(input.enabled);
    if (input.providerName !== undefined) data.providerName = input.providerName || null;
    if (input.modelName !== undefined) data.modelName = input.modelName || null;
    if (input.capabilities !== undefined) {
      data.capabilities = {
        ...((existing?.capabilities as Record<string, unknown>) ?? {}),
        ...sanitiseCapabilityModes(input.capabilities),
      };
    }
    if (input.instructions !== undefined) {
      const text = (input.instructions ?? '').trim();
      if (text.length > 4000) {
        throw new AssistantError('House rules must be shorter than 4000 characters.', 'TOO_LONG');
      }
      data.instructions = text || null;
    }
    if (input.maxStepsPerRun !== undefined) {
      const steps = Number(input.maxStepsPerRun);
      if (!Number.isFinite(steps) || steps < 2 || steps > 40) {
        throw new AssistantError('Steps per run must be between 2 and 40.', 'INVALID_VALUE');
      }
      data.maxStepsPerRun = Math.round(steps);
    }
    if (input.monthlyTokenBudget !== undefined) {
      if (input.monthlyTokenBudget === null || input.monthlyTokenBudget === 0) {
        data.monthlyTokenBudget = null;
      } else {
        const budget = Number(input.monthlyTokenBudget);
        if (!Number.isFinite(budget) || budget < 1000) {
          throw new AssistantError('A monthly limit must be at least 1000 tokens, or empty for no limit.', 'INVALID_VALUE');
        }
        data.monthlyTokenBudget = Math.round(budget);
      }
    }
    if (input.dailyRunLimit !== undefined) {
      const limit = Number(input.dailyRunLimit);
      if (!Number.isFinite(limit) || limit < 1 || limit > 10_000) {
        throw new AssistantError('A daily limit must be between 1 and 10000 runs.', 'INVALID_VALUE');
      }
      data.dailyRunLimit = Math.round(limit);
    }
    if (input.timezone !== undefined) {
      const zone = String(input.timezone || 'Africa/Harare');
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
      } catch {
        throw new AssistantError(`${zone} is not a timezone this system knows.`, 'INVALID_VALUE');
      }
      data.timezone = zone;
    }
    if (input.workingHours !== undefined) {
      data.workingHours = input.workingHours === null ? undefined : (parseWorkingHours(input.workingHours) as unknown);
      if (input.workingHours === null) data.workingHours = null;
    }
    if (input.memoryEnabled !== undefined) data.memoryEnabled = Boolean(input.memoryEnabled);
    if (input.whatsappEnabled !== undefined) data.whatsappEnabled = Boolean(input.whatsappEnabled);
    if (input.whatsappConfig !== undefined) data.whatsappConfig = parseWhatsApp(input.whatsappConfig) as unknown;
    if (input.browserAllowedDomains !== undefined) {
      data.browserAllowedDomains = [
        ...new Set(
          (input.browserAllowedDomains ?? [])
            .map(domain => String(domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
            .filter(domain => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
        ),
      ];
    }

    const saved = await prisma.assistantSettings.upsert({
      where: { organizationId: ctx.organizationId },
      create: {
        organizationId: ctx.organizationId,
        updatedById: ctx.userId,
        ...(data as Record<string, never>),
      },
      update: { ...(data as Record<string, never>), updatedById: ctx.userId },
    });

    this.clearCache(ctx.organizationId);

    // Turning the assistant on, changing what it may do unattended and
    // changing its model are all decisions somebody may need to account for
    // later, so the change itself is recorded - values included, since none of
    // them are credentials.
    await createAuditLog({
      action: existing ? 'UPDATE' : 'CREATE',
      resource: 'ASSISTANT_SETTINGS',
      resourceId: saved.id,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      previousValue: existing ? { enabled: existing.enabled, capabilities: existing.capabilities, modelName: existing.modelName } : null,
      newValue: { enabled: saved.enabled, capabilities: saved.capabilities, modelName: saved.modelName },
    }).catch(() => undefined);

    return this.resolve(ctx.organizationId);
  }

  /** Tokens the assistant has used this calendar month. */
  async tokensUsedThisMonth(organizationId: string): Promise<number> {
    const now = new Date();
    const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const totals = await prisma.assistantUsage.aggregate({
      where: { organizationId, day: { gte: firstOfMonth } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    return (totals._sum.inputTokens ?? 0) + (totals._sum.outputTokens ?? 0);
  }

  /** Runs started today, against the daily limit. */
  async runsToday(organizationId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return prisma.assistantRun.count({
      where: { organizationId, createdAt: { gte: startOfDay } },
    });
  }

  /** Record what a model call cost, for the usage screen and the budget. */
  async recordUsage(input: {
    organizationId: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    newRun?: boolean;
  }) {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    await prisma.assistantUsage.upsert({
      where: {
        organizationId_day_provider_model: {
          organizationId: input.organizationId,
          day,
          provider: input.provider,
          model: input.model,
        },
      },
      create: {
        organizationId: input.organizationId,
        day,
        provider: input.provider,
        model: input.model,
        runs: input.newRun ? 1 : 0,
        requests: 1,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
      },
      update: {
        runs: { increment: input.newRun ? 1 : 0 },
        requests: { increment: 1 },
        inputTokens: { increment: input.inputTokens },
        outputTokens: { increment: input.outputTokens },
      },
    });
  }

  /** Daily totals for the usage screen. */
  async usage(organizationId: string, days = 30) {
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    const rows = await prisma.assistantUsage.findMany({
      where: { organizationId, day: { gte: from } },
      orderBy: { day: 'asc' },
    });
    const totals = rows.reduce(
      (sum, row) => ({
        runs: sum.runs + row.runs,
        requests: sum.requests + row.requests,
        inputTokens: sum.inputTokens + row.inputTokens,
        outputTokens: sum.outputTokens + row.outputTokens,
      }),
      { runs: 0, requests: 0, inputTokens: 0, outputTokens: 0 }
    );
    return { days, rows, totals };
  }
}

export const assistantSettingsService = new AssistantSettingsService();
