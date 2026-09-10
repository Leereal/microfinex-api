import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

import { prisma } from '../src/config/database';
import { getModelCapabilities } from '../src/config/ai-models';

/**
 * Ask a model what it actually accepts, and compare that to our capability table.
 *
 * Google's API reports an unsupported request parameter as a flat "Request
 * contains an invalid argument" - it never names the field. That reaches an
 * operator as "this document could not be read", on a document that was never
 * the problem. Rather than infer which field a 400 is about, this sends the
 * smallest possible request per variant and reports what came back.
 *
 * Text and a 1x1 PNG only, a few tokens each: no client data leaves the machine.
 * Run it when adding a model to the catalog, or when a model starts failing.
 *
 *   npx tsx scripts/probe-model-capabilities.ts [model...]
 */

/** A 1x1 PNG. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
const RESOLUTIONS = ['low', 'medium', 'high', 'ultra_high'] as const;

const SCHEMA = {
  type: 'object',
  properties: { word: { type: 'string' } },
  required: ['word'],
};

const imagePart = (resolution?: string) => ({
  type: 'image',
  data: PIXEL,
  mime_type: 'image/png',
  ...(resolution ? { resolution } : {}),
});

/** Pull the real complaint out of the SDK's wrapper. */
function describe(error: any): string {
  let body = error?.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      /* keep the raw string */
    }
  }
  if (Array.isArray(body)) body = body[0];

  return (
    body?.error?.message ||
    error?.error?.message ||
    error?.message ||
    'unknown error'
  ).slice(0, 100);
}

async function accepts(
  ai: GoogleGenAI,
  request: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; why: string }> {
  try {
    await (ai as any).interactions.create(request);
    return { ok: true };
  } catch (error) {
    return { ok: false, why: describe(error) };
  }
}

async function probeModel(ai: GoogleGenAI, model: string) {
  console.log(`\n${model}`);

  // Generous enough that a thinking model can still produce an answer - too
  // small a budget makes a supported level look rejected.
  const base = {
    model,
    input: [{ type: 'text', text: 'One word.' }],
    generation_config: { max_output_tokens: 2048 },
  };

  // Thinking levels fall into three buckets, and only the first belongs in the
  // capability table:
  //
  //   usable      the request went through
  //   unusable    the level is advertised but no request can use it - Gemini
  //               2.5 Flash Lite advertises `low`, then rejects the 256-token
  //               budget it implies as below its 512 floor
  //   unsupported "is not a supported thinking level for this model"
  //
  // The table lists usable levels, because sending an unusable one costs a
  // wasted round trip on every extraction.
  const usable: string[] = [];
  const unusable: string[] = [];
  for (const level of THINKING_LEVELS) {
    const result = await accepts(ai, {
      ...base,
      generation_config: { max_output_tokens: 2048, thinking_level: level },
    });

    if (result.ok) {
      usable.push(level);
    } else if (/not a supported thinking level/i.test(result.why)) {
      console.log(`      ✗ ${level}: unsupported`);
    } else {
      unusable.push(level);
      console.log(`      ! ${level}: advertised but unusable - ${result.why}`);
    }
  }
  const thinking = usable;
  console.log(`  thinking levels     ${thinking.join(', ') || 'none usable'}`);

  // Media resolutions
  const resolutions: string[] = [];
  const resolutionRejections: string[] = [];
  for (const resolution of RESOLUTIONS) {
    const result = await accepts(ai, {
      ...base,
      input: [{ type: 'text', text: 'One word.' }, imagePart(resolution)],
    });
    if (result.ok) {
      resolutions.push(resolution);
    } else {
      resolutionRejections.push(`${resolution}: ${result.why}`);
    }
  }
  console.log(
    `  media resolutions   ${resolutions.join(', ') || 'none accepted'}`
  );
  resolutionRejections.forEach(line => console.log(`      ✗ ${line}`));

  // Structured output
  const structured = await accepts(ai, {
    ...base,
    input: [{ type: 'text', text: 'One word.' }, imagePart()],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: SCHEMA,
    },
  });
  console.log(
    `  response schema     ${structured.ok ? 'accepted' : `rejected (${structured.why})`}`
  );

  // Compare against what the table claims.
  const declared = getModelCapabilities(model);
  const mismatches: string[] = [];

  if (declared.supportsStructuredOutput !== structured.ok) {
    mismatches.push(
      `table says structured output ${declared.supportsStructuredOutput}, API says ${structured.ok}`
    );
  }

  const declaredThinking = declared.supportsThinking
    ? [...declared.thinkingLevels].sort().join(',')
    : '';
  if (declaredThinking !== [...thinking].sort().join(',')) {
    mismatches.push(
      `table says thinking [${declaredThinking}], API accepts [${[...thinking].sort().join(',')}]`
    );
  }

  const declaredResolutions = [...declared.mediaResolutions].sort().join(',');
  if (declaredResolutions !== [...resolutions].sort().join(',')) {
    mismatches.push(
      `table says resolutions [${declaredResolutions}], API accepts [${[...resolutions].sort().join(',')}]`
    );
  }

  if (mismatches.length === 0) {
    console.log('  ✅ matches getModelCapabilities()');
  } else {
    console.log('  ⚠️  getModelCapabilities() is out of date:');
    mismatches.forEach(line => console.log(`      - ${line}`));
  }
}

async function run() {
  const models =
    process.argv.slice(2).length > 0
      ? process.argv.slice(2)
      : ['gemma-4-31b-it', 'gemini-3.8-flash', 'gemini-2.5-flash-lite'];

  const config = await prisma.organizationAIConfig.findFirst({
    where: { isEnabled: true, aiProvider: { name: 'gemini' } },
    include: { aiProvider: true },
  });

  if (!config?.apiKey) {
    console.error('No enabled Gemini config with an API key found.');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });

  for (const model of models) {
    await probeModel(ai, model);
  }

  await prisma.$disconnect();
}

run().catch(async error => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
