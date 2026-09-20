import { GoogleGenAI } from '@google/genai';

import { prisma } from '../../src/config/database';
import {
  resolveThinkingLevel,
  getModelCapabilities,
} from '../../src/config/ai-models';

/**
 * Realistic people for the demo data, written by the model.
 *
 * Hand-written fixtures give you "Test Client 1" through "Test Client 40",
 * which is useless for judging whether a screen reads well: every name is the
 * same length, every occupation is "Developer", and nothing looks like the
 * Zimbabwean caseload the system is actually for.
 *
 * The model is asked for the narrative parts only - names, occupations,
 * employers, business names, loan purposes, note text. Every number that has
 * to add up is computed locally, because a language model is the wrong tool
 * for an amortisation schedule.
 *
 * If the model is unavailable, misconfigured, or answers nonsense, the local
 * generator below takes over and the seed run continues. Demo data is not
 * worth failing a seed over.
 */

const MODEL = 'gemini-3.1-flash-lite';

export interface Persona {
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE';
  occupation: string;
  employerName: string;
  /** Where they live, e.g. "12 Samora Machel Ave, Avondale". */
  addressLine1: string;
  suburb: string;
  city: string;
  /** Why they are borrowing, in their own words. */
  loanPurpose: string;
  /** Set for business clients. */
  businessName?: string;
  businessType?: string;
  /** A line an officer might have written on the file. */
  officerNote: string;
  nextOfKinName: string;
  nextOfKinRelationship: string;
}

const PERSONA_SCHEMA = {
  type: 'object',
  properties: {
    personas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          gender: { type: 'string', enum: ['MALE', 'FEMALE'] },
          occupation: { type: 'string' },
          employerName: { type: 'string' },
          addressLine1: { type: 'string' },
          suburb: { type: 'string' },
          city: { type: 'string' },
          loanPurpose: { type: 'string' },
          businessName: { type: 'string' },
          businessType: { type: 'string' },
          officerNote: { type: 'string' },
          nextOfKinName: { type: 'string' },
          nextOfKinRelationship: { type: 'string' },
        },
        required: [
          'firstName',
          'lastName',
          'gender',
          'occupation',
          'employerName',
          'addressLine1',
          'suburb',
          'city',
          'loanPurpose',
          'officerNote',
          'nextOfKinName',
          'nextOfKinRelationship',
        ],
      },
    },
  },
  required: ['personas'],
};

const prompt = (count: number, cities: string[]) => `
You are generating demo data for a Zimbabwean microfinance system, for a
training environment. These are invented people, not real ones.

Produce ${count} distinct borrower profiles that a loan officer in ${cities.join(
  ' or '
)} would plausibly have on file. Vary them widely:

- Shona, Ndebele and English given names and surnames, both genders.
- Occupations across the real economy: cross-border traders, commuter omnibus
  operators, schoolteachers, tailors, welders, poultry farmers, hairdressers,
  nurses, security guards, tuckshop owners, builders, mechanics.
- Employers that fit the occupation - real-sounding local firms, schools,
  councils, or "Self-employed" for informal traders.
- Addresses in real suburbs of those cities.
- Loan purposes in one short phrase, specific and concrete: "restock tuckshop
  before the school term", "replace omnibus gearbox", not "business expansion".
- businessName and businessType only where the person trades under a name.
- officerNote: one sentence a loan officer would actually write on a file -
  repayment behaviour, character, something observed on a visit.
- nextOfKinRelationship: one of Spouse, Parent, Sibling, Child, Relative.

Return only the JSON.`;

/** Deterministic pseudo-random, so a seed run can be reproduced. */
export function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const FIRST_NAMES = [
  'Tendai', 'Rudo', 'Farai', 'Chipo', 'Tapiwa', 'Nyasha', 'Takudzwa',
  'Rutendo', 'Blessing', 'Tinashe', 'Kudzai', 'Anesu', 'Simbarashe',
  'Chiedza', 'Munashe', 'Tarisai', 'Panashe', 'Vimbai', 'Tafadzwa', 'Shamiso',
  'Sipho', 'Nkosana', 'Thandiwe', 'Bongani', 'Nomsa', 'Sibusiso', 'Lindiwe',
  'Mthokozisi', 'Nokuthula', 'Themba',
];

const LAST_NAMES = [
  'Moyo', 'Ncube', 'Dube', 'Sibanda', 'Mhlanga', 'Chikafu', 'Marufu',
  'Mutasa', 'Chirwa', 'Zvobgo', 'Makoni', 'Mangwiro', 'Nyathi', 'Gumbo',
  'Chigumba', 'Mabhena', 'Muzenda', 'Kamusoko', 'Chiwenga', 'Masuku',
];

const OCCUPATIONS: Array<[string, string]> = [
  ['Cross-border trader', 'Self-employed'],
  ['Commuter omnibus operator', 'Self-employed'],
  ['Schoolteacher', 'Ministry of Primary Education'],
  ['Tailor', 'Self-employed'],
  ['Welder', 'Mabvuku Engineering Works'],
  ['Poultry farmer', 'Self-employed'],
  ['Hairdresser', 'Self-employed'],
  ['Nurse', 'Parirenyatwa Group of Hospitals'],
  ['Security guard', 'Safeguard Security'],
  ['Tuckshop owner', 'Self-employed'],
  ['Builder', 'Zvimba Construction'],
  ['Motor mechanic', 'Ruwa Auto Services'],
  ['Accounts clerk', 'Delta Beverages'],
  ['Shop assistant', 'OK Zimbabwe'],
];

const SUBURBS: Record<string, string[]> = {
  Harare: ['Avondale', 'Mbare', 'Highfield', 'Borrowdale', 'Glen View', 'Mabvuku'],
  Gweru: ['Mkoba', 'Senga', 'Ascot', 'Windsor Park', 'Mtapa'],
  Bulawayo: ['Nkulumane', 'Pumula', 'Hillside', 'Luveve'],
};

const PURPOSES = [
  'restock tuckshop before the school term',
  'replace omnibus gearbox',
  'buy fabric and a second sewing machine',
  'pay school fees for two children',
  'buy day-old chicks and feed',
  'stock up for cross-border trip to Musina',
  'repair shop roof before the rains',
  'buy welding rods and a generator',
  'expand vegetable stall at the market',
  'purchase a second-hand delivery bicycle',
];

const NOTES = [
  'Pays on time; keeps a written record of daily takings.',
  'Visited the stall - busy site, stock levels look healthy.',
  'Missed one instalment after a family funeral, settled the following week.',
  'Well known at the market; two traders vouched for her.',
  'Income is seasonal - collections should avoid January.',
  'Second cycle borrower, cleared the first loan early.',
];

const RELATIONSHIPS = ['Spouse', 'Parent', 'Sibling', 'Child', 'Relative'];

/** Personas without the model, used as a fallback and for offline runs. */
export function localPersonas(count: number, cities: string[], seed = 42): Persona[] {
  const random = makeRandom(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;

  return Array.from({ length: count }, (_, index) => {
    const [occupation, employerName] = pick(OCCUPATIONS);
    const city = cities[index % cities.length]!;
    const suburb = pick(SUBURBS[city] ?? SUBURBS.Harare!);
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const trades = employerName === 'Self-employed';

    return {
      firstName,
      lastName,
      gender: random() > 0.5 ? 'MALE' : 'FEMALE',
      occupation,
      employerName,
      addressLine1: `${Math.floor(random() * 200) + 1} ${pick([
        'Samora Machel Ave',
        'Robert Mugabe Rd',
        'Fife Street',
        'Leopold Takawira St',
        'Chinhoyi Street',
      ])}`,
      suburb,
      city,
      loanPurpose: pick(PURPOSES),
      ...(trades
        ? {
            businessName: `${lastName} ${pick([
              'Traders',
              'Enterprises',
              'General Dealers',
              'Investments',
            ])}`,
            businessType: 'SOLE_PROPRIETOR',
          }
        : {}),
      officerNote: pick(NOTES),
      nextOfKinName: `${pick(FIRST_NAMES)} ${lastName}`,
      nextOfKinRelationship: pick(RELATIONSHIPS),
    };
  });
}

/** Strip a markdown fence, then parse. Models add them even under a schema. */
function parseJson(text: string): any {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const object = trimmed.match(/[{[][\s\S]*[}\]]/);
  if (object?.[0]) candidates.push(object[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* next shape */
    }
  }
  throw new Error('The model did not return JSON');
}

const isUsable = (value: unknown): value is Persona => {
  const persona = value as Persona;
  return Boolean(
    persona &&
      typeof persona.firstName === 'string' &&
      persona.firstName.trim() &&
      typeof persona.lastName === 'string' &&
      persona.lastName.trim()
  );
};

/**
 * Ask the model for personas, falling back to the local generator.
 *
 * Returns which source was used so the run summary can say so honestly - it
 * matters when judging the data later.
 */
export async function generatePersonas(
  count: number,
  cities: string[],
  options: { seed?: number; useAi?: boolean } = {}
): Promise<{ personas: Persona[]; source: string }> {
  const fallback = () => ({
    personas: localPersonas(count, cities, options.seed ?? 42),
    source: 'local generator',
  });

  if (options.useAi === false) return fallback();

  const config = await prisma.organizationAIConfig.findFirst({
    where: { isEnabled: true, aiProvider: { name: 'gemini' } },
  });

  if (!config?.apiKey) {
    console.warn('  ! No Gemini key configured - using the local generator.');
    return fallback();
  }

  try {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const capabilities = getModelCapabilities(MODEL);
    const thinkingLevel = resolveThinkingLevel(MODEL, 'low', capabilities);

    const interaction = await (ai as any).interactions.create({
      model: MODEL,
      input: [{ type: 'text', text: prompt(count, cities) }],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        ...(capabilities.supportsStructuredOutput
          ? { schema: PERSONA_SCHEMA }
          : {}),
      },
      generation_config: {
        // Personas are long; a small budget truncates the array mid-object.
        max_output_tokens: 16384,
        ...(thinkingLevel ? { thinking_level: thinkingLevel } : {}),
      },
    });

    const parsed = parseJson(interaction.output_text as string);
    const personas: Persona[] = (parsed.personas ?? []).filter(isUsable);

    if (personas.length === 0) throw new Error('No usable personas returned');

    // Top up from the local generator if the model was stingy, so callers
    // always get the count they asked for.
    if (personas.length < count) {
      const extra = localPersonas(
        count - personas.length,
        cities,
        (options.seed ?? 42) + personas.length
      );
      personas.push(...extra);
    }

    return {
      personas: personas.slice(0, count),
      source: `${MODEL} (${personas.length} generated)`,
    };
  } catch (error: any) {
    console.warn(
      `  ! ${MODEL} could not generate personas (${error?.message ?? error}). Using the local generator.`
    );
    return fallback();
  }
}
