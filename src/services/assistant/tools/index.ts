/**
 * The tools a particular run is allowed, assembled from the organization's
 * settings and the permissions of the person the run acts for.
 *
 * A tool the organization has switched off, or that the person could not use
 * themselves, is not merely refused when called - it is never shown to the
 * model at all. A model that cannot see a tool does not argue about it, and a
 * prompt injected through an email cannot ask for one that was not offered.
 */

import { readTools } from './read.tools';
import { writeTools } from './write.tools';
import {
  CAPABILITY_BY_CODE,
  missingPermissions,
  resolveCapabilityMode,
  type AutonomyMode,
} from '../assistant.logic';
import { toolRegistry, type AssistantTool, type ToolContext } from './tool-kit';

/**
 * Tools contributed by the parts of the assistant that reach outside the
 * system - a connected mailbox, a browser, an MCP server, an HTTP API.
 *
 * They register themselves rather than being imported here, so that a run
 * which uses none of them never loads a browser or opens a connection.
 */
export type ExternalToolProvider = (ctx: ToolContext) => Promise<AssistantTool[]>;

const externalProviders: ExternalToolProvider[] = [];

export function registerExternalTools(provider: ExternalToolProvider) {
  externalProviders.push(provider);
}

/** For tests, which register their own. */
export function clearExternalTools() {
  externalProviders.length = 0;
  runCleanups.length = 0;
}

/**
 * Things to tidy up when a run ends - a browser page left open, a connection
 * to an MCP server. Registered by whatever opened them.
 */
type RunCleanup = (runId: string) => Promise<void> | void;
const runCleanups: RunCleanup[] = [];

export function registerRunCleanup(cleanup: RunCleanup) {
  runCleanups.push(cleanup);
}

export async function cleanUpRun(runId: string) {
  for (const cleanup of runCleanups) {
    try {
      await cleanup(runId);
    } catch (error) {
      console.error('Assistant cleanup failed:', (error as Error).message);
    }
  }
}

export interface AssembledTools {
  tools: AssistantTool[];
  registry: Map<string, AssistantTool>;
  /** What each tool will do when called: ASK or AUTO. */
  modes: Map<string, AutonomyMode>;
  /** Tools left out, and why - shown to staff, not to the model. */
  withheld: Array<{ name: string; reason: string }>;
}

export async function assembleTools(ctx: ToolContext): Promise<AssembledTools> {
  const native = [...readTools, ...writeTools];
  const external: AssistantTool[] = [];
  for (const provider of externalProviders) {
    try {
      external.push(...(await provider(ctx)));
    } catch (error) {
      console.error('Assistant external tools unavailable:', (error as Error).message);
    }
  }

  const tools: AssistantTool[] = [];
  const modes = new Map<string, AutonomyMode>();
  const withheld: Array<{ name: string; reason: string }> = [];

  for (const tool of [...native, ...external]) {
    const capability = CAPABILITY_BY_CODE.get(tool.capability);
    if (!capability) {
      withheld.push({ name: tool.name, reason: 'Unknown capability' });
      continue;
    }

    const mode = resolveCapabilityMode(ctx.settings.capabilities, tool.capability);
    if (mode === 'OFF') {
      withheld.push({ name: tool.name, reason: `${capability.name} is switched off` });
      continue;
    }

    const missing = missingPermissions(capability, ctx.permissions);
    if (missing.length > 0) {
      withheld.push({
        name: tool.name,
        reason: `You do not have ${missing.join(', ')}`,
      });
      continue;
    }

    // A client writing on WhatsApp gets a much smaller set: their own account,
    // and a way to reach a person.
    if (ctx.clientScopeId && !tool.clientFacing) {
      withheld.push({ name: tool.name, reason: 'Not available in a client conversation' });
      continue;
    }

    tools.push(tool);
    modes.set(tool.name, mode);
  }

  return { tools, registry: toolRegistry(tools), modes, withheld };
}

export { readTools, writeTools };
export type { AssistantTool, ToolContext };
