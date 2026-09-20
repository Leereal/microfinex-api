/**
 * What a tool is, and what it is given when it runs.
 *
 * A tool is the only way the assistant touches anything. Each one names the
 * capability it belongs to - which decides whether it runs, asks or is refused
 * - describes its arguments with a zod schema, and says in one line what it is
 * about to do, so a person approving it reads the action rather than a payload.
 *
 * Tools never receive an organization id or a user id from the model. Those
 * come from the run, so a prompt cannot talk the assistant into looking at
 * another lender's records or acting with somebody else's authority.
 */

import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ResolvedAssistantSettings } from '../assistant.settings.service';
import type { ToolSpec } from '../assistant.models';

export interface ToolContext {
  organizationId: string;
  /** The member of staff whose authority this run carries. */
  actingUserId: string;
  /** What that person may do - the tool never exceeds it. */
  permissions: Set<string>;
  settings: ResolvedAssistantSettings;
  runId: string;
  conversationId: string | null;
  /** The branch to use when a record needs one and none was given. */
  branchId: string | null;
  /**
   * A client-facing run may only ever see this client. Set for WhatsApp
   * threads, where the other party is a borrower rather than staff.
   */
  clientScopeId: string | null;
  /** Called when a tool returns content written outside the system. */
  markTainted: () => void;
  /** Files the person attached to this conversation. */
  artifactIds: string[];
}

export interface AssistantTool<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  capability: string;
  /** Written for the model: what it does and when to reach for it. */
  description: string;
  schema: Schema;
  /** One line for the run log and the approval card. */
  summarise: (args: z.infer<Schema>, ctx: ToolContext) => string | Promise<string>;
  execute: (args: z.infer<Schema>, ctx: ToolContext) => Promise<unknown>;
  /** Fields a person may correct on the approval card before approving. */
  editableFields?: string[];
  /** Extra detail for the approval card - who it would go to, what it says. */
  preview?: (args: z.infer<Schema>, ctx: ToolContext) => Promise<unknown>;
  /** Hidden from client-facing (WhatsApp) runs unless listed there. */
  clientFacing?: boolean;
  /**
   * The argument schema to show the model, where it is defined somewhere else
   * - an MCP server publishes its own, and re-deriving it from zod would lose
   * detail the server meant the model to see.
   */
  jsonSchema?: Record<string, unknown>;
  /** Always ask a person, even where the capability is set to run unattended. */
  alwaysAsk?: boolean;
  /**
   * Fields this tool cannot run without, given what it currently has.
   *
   * Read when an approval is shown, so the card can ask for what the
   * documents did not give - rather than letting somebody press Approve on
   * something that is bound to fail.
   */
  missingFields?: (args: z.infer<Schema>) => string[];
}

/** The tool as the model sees it. */
export function toolSpec(tool: AssistantTool): ToolSpec {
  if (tool.jsonSchema) {
    return {
      name: tool.name,
      description: tool.description,
      parameters: { type: 'object', properties: {}, ...tool.jsonSchema },
    };
  }

  // Plain JSON Schema draft 7, not the OpenAPI dialect: the OpenAPI target
  // writes `{ minimum: 0, exclusiveMinimum: true }` for a positive number,
  // and Gemini refuses that outright - "value at exclusiveMinimum must be a
  // number" - which killed every run where a tool took an amount.
  const schema = normaliseSchema(
    zodToJsonSchema(tool.schema, { $refStrategy: 'none' }) as Record<string, unknown>
  );

  // Providers differ on how much JSON Schema they accept; the common subset is
  // a plain object with properties, so anything else is flattened away.
  delete schema.$schema;
  delete schema.default;
  delete schema.definitions;
  if (schema.type !== 'object') {
    return {
      name: tool.name,
      description: tool.description,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    };
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: { additionalProperties: false, ...schema },
  };
}

/**
 * A schema every provider will accept.
 *
 * Draft 4 and OpenAPI write an exclusive bound as `exclusiveMinimum: true`
 * alongside `minimum`; draft 7 and everything the models actually validate
 * against want a number. Whichever dialect a schema arrives in - ours, or an
 * MCP server's - it leaves here in the numeric form, and a bound that cannot
 * be converted is dropped rather than sent as something a provider will reject.
 */
export function normaliseSchema<T>(node: T): T {
  if (Array.isArray(node)) return node.map(entry => normaliseSchema(entry)) as unknown as T;
  if (!node || typeof node !== 'object') return node;

  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = normaliseSchema(value);
  }

  for (const bound of ['exclusiveMinimum', 'exclusiveMaximum'] as const) {
    if (typeof out[bound] !== 'boolean') continue;
    const inclusive = bound === 'exclusiveMinimum' ? 'minimum' : 'maximum';
    if (out[bound] === true && typeof out[inclusive] === 'number') {
      out[bound] = out[inclusive];
      delete out[inclusive];
    } else {
      delete out[bound];
    }
  }

  return out as unknown as T;
}

/** Build a lookup of tools by name. */
export function toolRegistry(tools: AssistantTool[]): Map<string, AssistantTool> {
  return new Map(tools.map(tool => [tool.name, tool]));
}

/**
 * A result that is too large to hand back in full.
 *
 * Models pay for every character of a tool result and lose the thread in long
 * ones, so lists come back trimmed with a note about what was left out. The
 * assistant is told how to narrow the question instead.
 */
export function limitList<T>(rows: T[], limit: number, what: string) {
  if (rows.length <= limit) return { rows, truncated: false as const, total: rows.length };
  return {
    rows: rows.slice(0, limit),
    truncated: true as const,
    total: rows.length,
    note: `Showing the first ${limit} of ${rows.length} ${what}. Narrow the search for the rest.`,
  };
}

/** Money as staff read it, not as the database stores it. */
export function money(value: unknown, currency?: string | null): string {
  const amount = Number(value ?? 0);
  const formatted = Number.isFinite(amount)
    ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
  return currency ? `${currency} ${formatted}` : formatted;
}

/** A date the model can quote back without inventing a format. */
export function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function clientName(client: {
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
}): string {
  const person = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
  return person || client.businessName || 'Unnamed client';
}

/** Whole days between two dates, positive when the first is later. */
export function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / 86_400_000);
}
