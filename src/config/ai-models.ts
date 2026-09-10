/**
 * AI Model Catalog
 *
 * Curated list of models per provider, used to populate the model dropdown in
 * AI Settings. This is the fallback/base list — organizations can additionally
 * run live discovery (see aiExtractionService.discoverModels) which merges the
 * provider's own model listing into this catalog and persists it on the
 * organization's AI config.
 *
 * Google retires Gemini models fairly aggressively. RETIRED_MODELS maps a
 * shut-down model id to its recommended replacement so existing organization
 * configs can be migrated automatically instead of silently failing at
 * request time.
 */

export interface CatalogModel {
  id: string;
  name: string;
  description: string;
  /** True when the model can accept images / PDFs, which extraction requires. */
  supportsVision?: boolean;
  /** Preview / experimental models are offered but flagged in the UI. */
  isPreview?: boolean;
  /** Populated when the entry came from live provider discovery. */
  isDiscovered?: boolean;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

/** Default model used when an organization has not chosen one. */
export const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-3.8-flash',
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  deepseek: 'deepseek-chat',
  ollama: 'llava',
};

/**
 * Models Google has shut down, mapped to the replacement we migrate them to.
 * Keep this in sync with https://ai.google.dev/gemini-api/docs/models
 */
export const RETIRED_MODELS: Record<string, string> = {
  'gemini-2.0-flash': 'gemini-3.8-flash',
  'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.0-flash-exp': 'gemini-3.8-flash',
  'gemini-1.5-flash': 'gemini-3.5-flash',
  'gemini-1.5-flash-8b': 'gemini-3.5-flash-lite',
  'gemini-1.5-pro': 'gemini-2.5-pro',
  'gemini-pro': 'gemini-3.8-flash',
  'gemini-pro-vision': 'gemini-3.8-flash',
  'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite',
};

/**
 * Gemini models suitable for text + document/image understanding.
 *
 * Image-generation (Nano Banana), video (Veo), music (Lyria), TTS, embedding
 * and robotics models are deliberately excluded — they cannot perform document
 * extraction and would only clutter the picker.
 */
const GEMINI_MODELS: CatalogModel[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description: 'Most intelligent Flash model — best extraction accuracy',
    supportsVision: true,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    description: 'Previous-generation Flash for complex documents',
    supportsVision: true,
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    description: 'Balances speed with multimodal capability',
    supportsVision: true,
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    description: 'Routine, high-throughput document processing',
    supportsVision: true,
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    description: 'Fastest and most cost-effective 3.5 model',
    supportsVision: true,
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    description: 'Frontier-class performance at reduced cost',
    supportsVision: true,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Deep reasoning for difficult or low-quality scans',
    supportsVision: true,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Best price-performance of the 2.5 generation',
    supportsVision: true,
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    description: 'Fastest, most budget-friendly multimodal 2.5 model',
    supportsVision: true,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro (Preview)',
    description: 'Advanced intelligence for complex problem-solving',
    supportsVision: true,
    isPreview: true,
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash (Preview)',
    description: 'Frontier-class performance at reduced cost',
    supportsVision: true,
    isPreview: true,
  },
];

const CLAUDE_MODELS: CatalogModel[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    description: 'Balanced performance and cost',
    supportsVision: true,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    description: 'Strong document understanding',
    supportsVision: true,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    description: 'Fastest, most cost-effective',
    supportsVision: true,
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    description: 'Most capable of the Claude 3 family',
    supportsVision: true,
  },
];

const OPENAI_MODELS: CatalogModel[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'Most capable multimodal model',
    supportsVision: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: 'Fast and affordable',
    supportsVision: true,
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    description: 'High capability',
    supportsVision: true,
  },
];

const DEEPSEEK_MODELS: CatalogModel[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    description: 'General purpose (text only)',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    description: 'Reasoning-optimized (text only)',
  },
];

const OLLAMA_MODELS: CatalogModel[] = [
  {
    id: 'llava',
    name: 'LLaVA',
    description: 'Vision-language model — required for document extraction',
    supportsVision: true,
  },
  {
    id: 'llama3.2-vision',
    name: 'Llama 3.2 Vision',
    description: 'Meta Llama 3.2 with vision',
    supportsVision: true,
  },
  {
    id: 'llama3.2',
    name: 'Llama 3.2',
    description: 'Meta Llama 3.2 (text only)',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    description: 'Mistral 7B (text only)',
  },
];

export const MODEL_CATALOG: Record<string, CatalogModel[]> = {
  gemini: GEMINI_MODELS,
  claude: CLAUDE_MODELS,
  openai: OPENAI_MODELS,
  deepseek: DEEPSEEK_MODELS,
  ollama: OLLAMA_MODELS,
};

/**
 * Resolve the model a provider should actually be called with, substituting a
 * replacement when the configured model has been retired.
 */
export function resolveModelName(
  providerName: string,
  modelName: string | null | undefined
): string {
  if (!modelName) {
    return DEFAULT_MODELS[providerName] || 'gemini-3.8-flash';
  }
  return RETIRED_MODELS[modelName] || modelName;
}

/** True when the configured model is one we know has been shut down. */
export function isRetiredModel(modelName: string | null | undefined): boolean {
  return !!modelName && modelName in RETIRED_MODELS;
}

/**
 * Merge the curated catalog with models found by live provider discovery.
 * Discovered entries that are already in the catalog keep their curated
 * description; genuinely new ones are appended and flagged.
 */
export function mergeModels(
  providerName: string,
  discovered: CatalogModel[] = []
): CatalogModel[] {
  const catalog = MODEL_CATALOG[providerName] || [];
  const byId = new Map<string, CatalogModel>();

  for (const model of catalog) {
    byId.set(model.id, model);
  }

  for (const model of discovered) {
    // Never surface a model we know is dead, even if the API still lists it.
    if (model.id in RETIRED_MODELS) continue;

    const existing = byId.get(model.id);
    if (existing) {
      byId.set(model.id, {
        ...existing,
        inputTokenLimit: model.inputTokenLimit ?? existing.inputTokenLimit,
        outputTokenLimit: model.outputTokenLimit ?? existing.outputTokenLimit,
      });
    } else {
      byId.set(model.id, { ...model, isDiscovered: true });
    }
  }

  return Array.from(byId.values());
}

/* ------------------------------------------------------------------------ *
 * Model capabilities
 *
 * Not every model reachable through a provider's API accepts every request
 * parameter, and Google reports a rejected one as a flat "Request contains an
 * invalid argument" that never names the field. That surfaces to an operator as
 * a failed extraction on a document that was never the problem.
 *
 * These values were measured, not inferred - re-check them with
 * `npx tsx scripts/probe-model-capabilities.ts`, which compares this table
 * against what the API actually accepts.
 * ------------------------------------------------------------------------ */

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/** Per-image fidelity hint, cheapest first. */
export type MediaResolution = 'low' | 'medium' | 'high' | 'ultra_high';

const ALL_THINKING_LEVELS: ThinkingLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
];

const ALL_MEDIA_RESOLUTIONS: MediaResolution[] = [
  'low',
  'medium',
  'high',
  'ultra_high',
];

export interface ModelCapabilities {
  /** The model accepts `generation_config.thinking_level`. */
  supportsThinking: boolean;
  /** The thinking levels it accepts, cheapest first. */
  thinkingLevels: ThinkingLevel[];
  /** The model accepts a `response_format` JSON schema. */
  supportsStructuredOutput: boolean;
  /** The per-image `resolution` values it accepts, cheapest first. */
  mediaResolutions: MediaResolution[];
}

/**
 * Measured families.
 *
 * Every row here was answered by the API, not read off a datasheet - none of
 * these differences are documented. What was measured:
 *
 *   gemma-4-31b-it          minimal, high          resolutions up to high
 *   gemini-2.5-flash/pro    low, high              all resolutions
 *   gemini-2.5-flash-lite   low, high *            all resolutions
 *   gemini-3.1/3.5-*        minimal, low, med, high  all resolutions
 *   gemini-3.7/3.8-flash    low, medium, high      all resolutions
 *
 *   * flash-lite advertises `low` but rejects the 256-token budget it implies
 *     ("choose a value between 512 and 24576"), so `high` is its only usable
 *     level and pretending otherwise costs a wasted round trip per extraction.
 *
 * The table exists only to get the first request right; `ai-extraction.service`
 * retries on the provider's own complaint, so a model that does not match one
 * of these patterns still works - it just pays one extra round trip. Re-check
 * with `npx tsx scripts/probe-model-capabilities.ts`, which diffs this against
 * the live API.
 */
const CAPABILITY_FAMILIES: Array<{
  matches: (id: string) => boolean;
  capabilities: ModelCapabilities;
}> = [
  {
    // Open-weight builds served over the Gemini API.
    matches: id => id.startsWith('gemma') || id.includes('/gemma'),
    capabilities: {
      supportsThinking: true,
      // "Allowed values are: minimal, high."
      thinkingLevels: ['minimal', 'high'],
      // Structured output works fine here, despite Google's "Gemma on the
      // Gemini API" page never mentioning it.
      supportsStructuredOutput: true,
      // ultra_high is a Gemini-3 feature. Sending it to Gemma is what produced
      // "Request contains an invalid argument" - the whole bug.
      mediaResolutions: ['low', 'medium', 'high'],
    },
  },
  {
    // Its 512-token thinking floor rules out `low`, whose budget is 256.
    matches: id => id.startsWith('gemini-2.5-flash-lite'),
    capabilities: {
      supportsThinking: true,
      thinkingLevels: ['high'],
      supportsStructuredOutput: true,
      mediaResolutions: ALL_MEDIA_RESOLUTIONS,
    },
  },
  {
    matches: id => id.startsWith('gemini-2.5'),
    capabilities: {
      supportsThinking: true,
      // "Allowed values are: low, high."
      thinkingLevels: ['low', 'high'],
      supportsStructuredOutput: true,
      mediaResolutions: ALL_MEDIA_RESOLUTIONS,
    },
  },
  {
    // 3.7 onward dropped `minimal`; 3.1 through 3.6 still have it.
    matches: id => /^gemini-3\.(?:[7-9]|\d{2,})/.test(id),
    capabilities: {
      supportsThinking: true,
      thinkingLevels: ['low', 'medium', 'high'],
      supportsStructuredOutput: true,
      mediaResolutions: ALL_MEDIA_RESOLUTIONS,
    },
  },
];

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  supportsThinking: true,
  thinkingLevels: ALL_THINKING_LEVELS,
  supportsStructuredOutput: true,
  mediaResolutions: ALL_MEDIA_RESOLUTIONS,
};

/**
 * What a model will accept in a request.
 *
 * An unrecognised model is assumed to take everything: the retry path costs one
 * extra round trip when that is wrong, whereas assuming too little would
 * quietly degrade every extraction on a model that was perfectly capable.
 */
export function getModelCapabilities(
  modelId: string | null | undefined
): ModelCapabilities {
  const id = (modelId || '').toLowerCase();
  return (
    CAPABILITY_FAMILIES.find(family => family.matches(id))?.capabilities ??
    DEFAULT_CAPABILITIES
  );
}

/** Pick the nearest allowed rung to what was asked for; ties go to the cheaper. */
function nearestAllowed<T extends string>(
  ladder: readonly T[],
  allowed: readonly T[],
  wanted: T
): T | null {
  if (allowed.length === 0) return null;
  if (allowed.includes(wanted)) return wanted;

  const rank = (value: T) => ladder.indexOf(value);
  const target = rank(wanted);

  return allowed.reduce((best, value) =>
    Math.abs(rank(value) - target) < Math.abs(rank(best) - target) ? value : best
  );
}

/**
 * The thinking level to actually send.
 *
 * When the organization's choice is not on the model's list, fall back to the
 * nearest one it does accept rather than dropping the setting or failing the
 * request - the operator asked for "cheap" or "thorough", and the closest
 * available rung honours that intent.
 */
export function resolveThinkingLevel(
  modelId: string | null | undefined,
  desired: string | null | undefined,
  capabilities: ModelCapabilities = getModelCapabilities(modelId)
): ThinkingLevel | null {
  if (!capabilities.supportsThinking) return null;

  const wanted = ALL_THINKING_LEVELS.includes(desired as ThinkingLevel)
    ? (desired as ThinkingLevel)
    : 'low';

  return nearestAllowed(
    ALL_THINKING_LEVELS,
    capabilities.thinkingLevels,
    wanted
  );
}

/**
 * The per-image resolution to actually send.
 *
 * Identity documents are frequently faded photocopies or phone photos where the
 * ID number is only a few pixels tall, so extraction asks for the highest
 * fidelity the model offers. Asking for more than it offers fails the whole
 * request, which is worse than reading the document at one rung down.
 */
export function resolveMediaResolution(
  modelId: string | null | undefined,
  desired: string | null | undefined,
  capabilities: ModelCapabilities = getModelCapabilities(modelId)
): MediaResolution | null {
  const allowed = capabilities.mediaResolutions;
  if (allowed.length === 0) return null;

  const wanted = ALL_MEDIA_RESOLUTIONS.includes(desired as MediaResolution)
    ? (desired as MediaResolution)
    : 'ultra_high';

  return nearestAllowed(ALL_MEDIA_RESOLUTIONS, allowed, wanted);
}

/**
 * The next thinking level up that this model accepts, or null at the top.
 *
 * Used when a level is accepted but its implied token budget is not - Gemini
 * 2.5 Flash Lite rejects `low` with "The thinking budget 256 is invalid. Please
 * choose a value between 512 and 24576." Thinking harder is the way out of
 * that, not thinking less.
 */
export function stepUpThinkingLevel(
  modelId: string | null | undefined,
  current: string | null | undefined,
  capabilities: ModelCapabilities = getModelCapabilities(modelId)
): ThinkingLevel | null {
  const allowed = capabilities.thinkingLevels;
  const index = ALL_THINKING_LEVELS.indexOf(current as ThinkingLevel);
  if (index < 0) return null;

  return (
    ALL_THINKING_LEVELS.slice(index + 1).find(level =>
      allowed.includes(level)
    ) ?? null
  );
}

/** The next rung down, or null when already at the cheapest. */
export function stepDownResolution(
  current: string | null | undefined
): MediaResolution | null {
  const index = ALL_MEDIA_RESOLUTIONS.indexOf(current as MediaResolution);
  if (index <= 0) return null;
  return ALL_MEDIA_RESOLUTIONS[index - 1]!;
}

/** Parse "Allowed values are: high, minimal." out of a provider's complaint. */
export function parseAllowedThinkingLevels(message: string): ThinkingLevel[] {
  const match = message.match(/allowed values are:?\s*([^.]+)/i);
  if (!match?.[1]) return [];

  return match[1]
    .split(/[,\s]+/)
    .map(value => value.trim().toLowerCase())
    .filter((value): value is ThinkingLevel =>
      ALL_THINKING_LEVELS.includes(value as ThinkingLevel)
    );
}
