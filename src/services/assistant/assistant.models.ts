/**
 * Talking to whichever model the organization has configured.
 *
 * The organization already chooses an AI provider for document extraction, and
 * the assistant uses that same choice unless it has been given one of its own.
 * Each provider is wrapped in the same small interface - a system prompt, a
 * transcript, a list of tools, and back come text and tool calls - so the rest
 * of the assistant never learns which provider it is talking to.
 *
 * Two details matter more than they look:
 *
 *   * Each provider's own version of an assistant turn is kept verbatim in
 *     `providerData` and sent back next time. Gemini signs its reasoning and
 *     rejects a conversation where the signature is missing; Anthropic does the
 *     same with thinking blocks; DeepSeek needs its reasoning content back
 *     while a tool call is in flight. Re-building those turns from our own
 *     records would break tool calling on all three.
 *   * Tool results are matched to calls by id. Where a provider does not give
 *     an id (Gemini often does not), one is made up and kept alongside the
 *     call, so the pairing survives the round trip.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { aiExtractionService, type AIProviderConfig } from '../ai-extraction.service';
import { resolveModelName } from '../../config/ai-models';
import { AssistantError } from './assistant.logic';

export interface ToolSpec {
  name: string;
  description: string;
  /** A JSON Schema object describing the arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type Turn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[]; providerData?: unknown }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ModelRequest {
  system: string;
  turns: Turn[];
  tools: ToolSpec[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ModelReply {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  /** The provider's own representation of this turn, to be sent back. */
  providerData?: unknown;
  finishReason: string;
}

export interface ModelAdapter {
  provider: string;
  model: string;
  label: string;
  complete(request: ModelRequest): Promise<ModelReply>;
}

const DEFAULT_MAX_TOKENS = 4096;

/** A stable id for a call the provider did not give one for. */
let callCounter = 0;
function syntheticCallId(name: string): string {
  callCounter += 1;
  return `call_${callCounter}_${name.slice(0, 24)}`;
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A model that emits malformed JSON gets told so by the tool layer, which
    // validates arguments; an empty object reaches it with a clear complaint.
    return {};
  }
}

// ------------------------------------------------------------- OpenAI-shaped

/**
 * OpenAI, DeepSeek and Ollama all speak the OpenAI chat API, so they share one
 * adapter and differ only in base URL and a couple of parameter names.
 */
function openAICompatibleAdapter(config: AIProviderConfig): ModelAdapter {
  const provider = config.name;
  const model = resolveModelName(provider, config.modelName);
  const isOllama = provider === 'ollama';

  const baseURL = isOllama
    ? `${(config.baseUrl || 'http://localhost:11434').replace(/\/+$/, '')}/v1`
    : provider === 'deepseek'
      ? (config.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')
      : undefined;

  if (!config.apiKey && !isOllama) {
    throw new AssistantError(
      `No API key is saved for ${config.displayName}. Add one in Settings → AI.`,
      'MODEL_NOT_CONFIGURED'
    );
  }

  const client = new OpenAI({
    apiKey: config.apiKey || 'ollama',
    ...(baseURL ? { baseURL } : {}),
    maxRetries: 2,
  });

  return {
    provider,
    model,
    label: `${config.displayName} · ${model}`,
    async complete(request) {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: request.system },
      ];

      for (const turn of request.turns) {
        if (turn.role === 'user') {
          messages.push({ role: 'user', content: turn.content });
        } else if (turn.role === 'assistant') {
          // The provider's own message is replayed when we kept it: DeepSeek's
          // reasoning content has to come back with the tool call it belongs to.
          const stored = turn.providerData as OpenAI.Chat.ChatCompletionMessageParam | undefined;
          if (stored && typeof stored === 'object' && 'role' in stored) {
            messages.push(stored);
          } else {
            messages.push({
              role: 'assistant',
              content: turn.content || null,
              ...(turn.toolCalls.length > 0 && {
                tool_calls: turn.toolCalls.map(call => ({
                  id: call.id,
                  type: 'function' as const,
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                })),
              }),
            } as OpenAI.Chat.ChatCompletionMessageParam);
          }
        } else {
          messages.push({ role: 'tool', tool_call_id: turn.toolCallId, content: turn.content });
        }
      }

      const tokenLimit = request.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS;
      const response = await client.chat.completions.create(
        {
          model,
          messages,
          ...(request.tools.length > 0 && {
            tools: request.tools.map(tool => ({
              type: 'function' as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters as Record<string, unknown>,
              },
            })),
            tool_choice: 'auto' as const,
          }),
          // Newer OpenAI reasoning models reject max_tokens and a custom
          // temperature; the other two accept the older names.
          ...(provider === 'openai'
            ? { max_completion_tokens: tokenLimit }
            : { max_tokens: tokenLimit, temperature: config.temperature ?? 0.2 }),
        },
        { signal: request.signal }
      );

      const choice = response.choices[0];
      const message = choice?.message;
      const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
        .filter((call): call is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => 'function' in call)
        .map(call => ({
          id: call.id || syntheticCallId(call.function.name),
          name: call.function.name,
          arguments: parseArguments(call.function.arguments),
        }));

      return {
        text: typeof message?.content === 'string' ? message.content : '',
        toolCalls,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
        providerData: message ?? undefined,
        finishReason: choice?.finish_reason ?? 'stop',
      };
    },
  };
}

// ----------------------------------------------------------------- Anthropic

function anthropicAdapter(config: AIProviderConfig): ModelAdapter {
  if (!config.apiKey) {
    throw new AssistantError(
      'No API key is saved for Anthropic Claude. Add one in Settings → AI.',
      'MODEL_NOT_CONFIGURED'
    );
  }
  const model = resolveModelName('claude', config.modelName);
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 2 });

  return {
    provider: 'claude',
    model,
    label: `${config.displayName} · ${model}`,
    async complete(request) {
      const messages: Anthropic.MessageParam[] = [];

      for (const turn of request.turns) {
        if (turn.role === 'user') {
          messages.push({ role: 'user', content: turn.content });
        } else if (turn.role === 'assistant') {
          const stored = turn.providerData as Anthropic.ContentBlockParam[] | undefined;
          if (Array.isArray(stored) && stored.length > 0) {
            // Thinking blocks carry a signature that must return unaltered.
            messages.push({ role: 'assistant', content: stored });
          } else {
            const blocks: Anthropic.ContentBlockParam[] = [];
            if (turn.content) blocks.push({ type: 'text', text: turn.content });
            for (const call of turn.toolCalls) {
              blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
            }
            if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks });
          }
        } else {
          // Results for calls made in the same turn belong in one user message.
          const block: Anthropic.ToolResultBlockParam = {
            type: 'tool_result',
            tool_use_id: turn.toolCallId,
            content: turn.content,
          };
          const last = messages[messages.length - 1];
          if (last?.role === 'user' && Array.isArray(last.content)) {
            (last.content as Anthropic.ContentBlockParam[]).push(block);
          } else {
            messages.push({ role: 'user', content: [block] });
          }
        }
      }

      const response = await client.messages.create(
        {
          model,
          system: request.system,
          messages,
          max_tokens: request.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(request.tools.length > 0 && {
            tools: request.tools.map(tool => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters as Anthropic.Tool.InputSchema,
            })),
          }),
        },
        { signal: request.signal }
      );

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n')
        .trim();

      const toolCalls: ToolCall[] = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map(block => ({
          id: block.id,
          name: block.name,
          arguments: (block.input ?? {}) as Record<string, unknown>,
        }));

      return {
        text,
        toolCalls,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
        providerData: response.content,
        finishReason: response.stop_reason ?? 'end_turn',
      };
    },
  };
}

// -------------------------------------------------------------------- Gemini

/**
 * Gemini takes a subset of JSON Schema, and refuses the whole request over
 * anything outside it - a `format: "uuid"`, an `additionalProperties`, an
 * exclusive bound written the old way. The error it returns names one field
 * and stops the conversation, so the schema is trimmed to what it documents
 * rather than sent hopefully.
 */
const GEMINI_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'anyOf',
  'example',
]);

/** The only formats Gemini recognises, by type. */
const GEMINI_FORMATS: Record<string, string[]> = {
  string: ['date-time', 'enum'],
  integer: ['int32', 'int64'],
  number: ['float', 'double'],
};

export function geminiSchema<T>(node: T): T {
  if (Array.isArray(node)) return node.map(entry => geminiSchema(entry)) as unknown as T;
  if (!node || typeof node !== 'object') return node;

  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    // A choice of shapes is always anyOf here; oneOf and allOf are not taken.
    if (key === 'oneOf' || key === 'allOf') {
      out.anyOf = geminiSchema(value);
      continue;
    }
    // A fixed value is a one-entry enum.
    if (key === 'const') {
      out.enum = [value];
      continue;
    }
    // An exclusive bound becomes the inclusive one it is nearly equal to;
    // losing the boundary itself matters far less than losing the tool.
    if (key === 'exclusiveMinimum' && typeof value === 'number') {
      out.minimum = value;
      continue;
    }
    if (key === 'exclusiveMaximum' && typeof value === 'number') {
      out.maximum = value;
      continue;
    }
    if (!GEMINI_KEYS.has(key)) continue;

    // `properties` is a map of names to schemas, not a schema. Converting it
    // as one drops every field name in it - which leaves the model holding a
    // tool that appears to take no arguments at all.
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([field, schema]) => [field, geminiSchema(schema)])
      );
      continue;
    }

    // Values, not schemas: passed through as they are.
    out[key] = key === 'enum' || key === 'required' || key === 'example' ? value : geminiSchema(value);
  }

  const type = typeof out.type === 'string' ? (out.type as string) : null;
  if (out.format && (!type || !(GEMINI_FORMATS[type] ?? []).includes(String(out.format)))) {
    // uuid, email and the rest are documentation to us and an error to Gemini;
    // the description still tells the model what the value should look like.
    delete out.format;
  }

  return out as unknown as T;
}

function geminiAdapter(config: AIProviderConfig): ModelAdapter {
  if (!config.apiKey) {
    throw new AssistantError(
      'No API key is saved for Google Gemini. Add one in Settings → AI.',
      'MODEL_NOT_CONFIGURED'
    );
  }
  const model = resolveModelName('gemini', config.modelName);
  const client = new GoogleGenAI({ apiKey: config.apiKey });

  return {
    provider: 'gemini',
    model,
    label: `${config.displayName} · ${model}`,
    async complete(request) {
      const contents: Array<Record<string, unknown>> = [];

      for (const turn of request.turns) {
        if (turn.role === 'user') {
          contents.push({ role: 'user', parts: [{ text: turn.content }] });
        } else if (turn.role === 'assistant') {
          const stored = turn.providerData as Record<string, unknown> | undefined;
          if (stored && typeof stored === 'object' && Array.isArray((stored as { parts?: unknown }).parts)) {
            // Gemini signs its reasoning; the signature travels in the parts
            // and the next call is rejected without it.
            contents.push({ role: 'model', ...stored });
          } else {
            const parts: Array<Record<string, unknown>> = [];
            if (turn.content) parts.push({ text: turn.content });
            for (const call of turn.toolCalls) {
              parts.push({ functionCall: { name: call.name, args: call.arguments } });
            }
            if (parts.length > 0) contents.push({ role: 'model', parts });
          }
        } else {
          const part = {
            functionResponse: {
              name: turn.name,
              response: { result: turn.content },
            },
          };
          const last = contents[contents.length - 1];
          if (last?.role === 'user' && Array.isArray(last.parts) && (last.parts as unknown[]).every(entry => 'functionResponse' in (entry as object))) {
            (last.parts as unknown[]).push(part);
          } else {
            contents.push({ role: 'user', parts: [part] });
          }
        }
      }

      const response = await client.models.generateContent({
        model,
        contents: contents as never,
        config: {
          systemInstruction: request.system,
          maxOutputTokens: request.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS,
          abortSignal: request.signal,
          ...(request.tools.length > 0 && {
            tools: [
              {
                functionDeclarations: request.tools.map(tool => ({
                  name: tool.name,
                  description: tool.description,
                  parametersJsonSchema: geminiSchema(tool.parameters),
                })),
              },
            ],
          }),
        } as never,
      });

      const candidate = response.candidates?.[0];
      const parts = (candidate?.content?.parts ?? []) as Array<Record<string, unknown>>;

      const text = parts
        .filter(part => typeof part.text === 'string' && !part.thought)
        .map(part => String(part.text))
        .join('\n')
        .trim();

      const toolCalls: ToolCall[] = parts
        .filter(part => part.functionCall)
        .map(part => {
          const call = part.functionCall as { id?: string; name?: string; args?: Record<string, unknown> };
          return {
            id: call.id || syntheticCallId(call.name ?? 'tool'),
            name: call.name ?? 'unknown',
            arguments: call.args ?? {},
          };
        });

      return {
        text,
        toolCalls,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens:
            (response.usageMetadata?.candidatesTokenCount ?? 0) +
            (response.usageMetadata?.thoughtsTokenCount ?? 0),
        },
        providerData: candidate?.content,
        finishReason: candidate?.finishReason ?? 'STOP',
      };
    },
  };
}

/** Build the adapter for a provider configuration. */
export function createAdapter(config: AIProviderConfig): ModelAdapter {
  switch (config.name) {
    case 'gemini':
      return geminiAdapter(config);
    case 'claude':
      return anthropicAdapter(config);
    case 'openai':
    case 'deepseek':
    case 'ollama':
      return openAICompatibleAdapter(config);
    default:
      throw new AssistantError(
        `${config.displayName} cannot be used by the assistant yet.`,
        'MODEL_NOT_SUPPORTED'
      );
  }
}

/**
 * Which model this organization's assistant should use.
 *
 * The organization's primary AI provider, unless the assistant has been given
 * a provider or a model of its own in its settings. A provider that is named
 * in the assistant settings but no longer enabled falls back to the primary
 * one rather than failing, so removing a provider does not silently stop the
 * assistant.
 */
export async function resolveAssistantModel(
  organizationId: string,
  override: { providerName?: string | null; modelName?: string | null } = {}
): Promise<ModelAdapter> {
  const providers = await aiExtractionService.getEnabledProviders(organizationId);
  if (providers.length === 0) {
    throw new AssistantError(
      'No AI provider is set up for this organization yet. Add one in Settings → AI before using the assistant.',
      'MODEL_NOT_CONFIGURED'
    );
  }

  const chosen =
    (override.providerName && providers.find(provider => provider.name === override.providerName)) ||
    providers[0]!;

  const config: AIProviderConfig = {
    ...chosen,
    modelName: override.modelName || chosen.modelName,
  };

  return createAdapter(config);
}

/** Providers and models the assistant may be pointed at, for the settings screen. */
export async function assistantModelOptions(organizationId: string) {
  const providers = await aiExtractionService.getEnabledProviders(organizationId);
  return providers.map((provider, index) => ({
    name: provider.name,
    displayName: provider.displayName,
    currentModel: provider.modelName,
    isPrimary: index === 0,
    isLocal: provider.isLocal,
    hasKey: Boolean(provider.apiKey) || provider.isLocal,
  }));
}
