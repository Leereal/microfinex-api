import {
  getModelCapabilities,
  parseAllowedThinkingLevels,
  resolveMediaResolution,
  resolveThinkingLevel,
  stepDownResolution,
  stepUpThinkingLevel,
} from '../src/config/ai-models';

/**
 * These expectations were measured against the live API with
 * `scripts/probe-model-capabilities.ts`, not read off the documentation -
 * Google's "Gemma on the Gemini API" page documents neither the resolution
 * ceiling nor structured-output support.
 */
describe('model capabilities', () => {
  it('knows Gemma tops out below ultra_high', () => {
    const gemma = getModelCapabilities('gemma-4-31b-it');
    expect(gemma.mediaResolutions).toEqual(['low', 'medium', 'high']);
    expect(gemma.mediaResolutions).not.toContain('ultra_high');
  });

  it('knows Gemma does accept a response schema', () => {
    // The earlier assumption that it did not was wrong, and cost extraction
    // accuracy for no reason.
    expect(getModelCapabilities('gemma-4-31b-it').supportsStructuredOutput).toBe(
      true
    );
  });

  it('lets Gemini models use the full resolution range', () => {
    expect(
      getModelCapabilities('gemini-3.8-flash').mediaResolutions
    ).toContain('ultra_high');
    expect(
      getModelCapabilities('gemini-2.5-flash-lite').mediaResolutions
    ).toContain('ultra_high');
  });

  it('assumes an unknown model takes everything', () => {
    const caps = getModelCapabilities('some-model-shipped-tomorrow');
    expect(caps.supportsStructuredOutput).toBe(true);
    expect(caps.thinkingLevels).toContain('low');
    expect(caps.mediaResolutions).toContain('ultra_high');
  });
});

describe('resolveMediaResolution', () => {
  it('asks Gemini for the highest fidelity', () => {
    expect(resolveMediaResolution('gemini-3.8-flash', undefined)).toBe(
      'ultra_high'
    );
  });

  it('caps Gemma at the highest it accepts', () => {
    // This is the whole bug: sending ultra_high here failed the request with
    // "Request contains an invalid argument".
    expect(resolveMediaResolution('gemma-4-31b-it', undefined)).toBe('high');
    expect(resolveMediaResolution('gemma-4-31b-it', 'ultra_high')).toBe('high');
  });

  it("honours an organization's explicit lower choice", () => {
    expect(resolveMediaResolution('gemini-3.8-flash', 'medium')).toBe('medium');
    expect(resolveMediaResolution('gemma-4-31b-it', 'low')).toBe('low');
  });
});

describe('stepDownResolution', () => {
  it('walks down one rung at a time', () => {
    expect(stepDownResolution('ultra_high')).toBe('high');
    expect(stepDownResolution('high')).toBe('medium');
    expect(stepDownResolution('medium')).toBe('low');
  });

  it('stops at the cheapest rung', () => {
    expect(stepDownResolution('low')).toBeNull();
    expect(stepDownResolution(null)).toBeNull();
  });
});

describe('thinking levels differ per family', () => {
  // Every expectation below was answered by the live API via
  // scripts/probe-model-capabilities.ts. None of it is documented.
  const levelsFor = (model: string) =>
    getModelCapabilities(model).thinkingLevels;

  it('knows Gemini 3.7+ dropped minimal', () => {
    expect(levelsFor('gemini-3.8-flash')).toEqual(['low', 'medium', 'high']);
    expect(levelsFor('gemini-3.7-flash')).toEqual(['low', 'medium', 'high']);
  });

  it('knows Gemini 3.1 through 3.6 still have minimal', () => {
    expect(levelsFor('gemini-3.5-flash')).toContain('minimal');
    expect(levelsFor('gemini-3.5-flash-lite')).toContain('minimal');
    expect(levelsFor('gemini-3.1-flash-lite')).toContain('minimal');
  });

  it('knows Gemini 2.5 has only low and high', () => {
    expect(levelsFor('gemini-2.5-flash')).toEqual(['low', 'high']);
    expect(levelsFor('gemini-2.5-pro')).toEqual(['low', 'high']);
  });

  it("leaves out 2.5 Flash Lite's unusable low", () => {
    // It advertises low, then rejects the 256-token budget that implies as
    // below its 512 floor. Listing it would cost a wasted round trip on every
    // extraction.
    expect(levelsFor('gemini-2.5-flash-lite')).toEqual(['high']);
  });

  it('knows Gemma has only minimal and high', () => {
    expect(levelsFor('gemma-4-31b-it')).toEqual(['minimal', 'high']);
  });
});

describe('stepUpThinkingLevel', () => {
  it('climbs to the next level the model accepts', () => {
    // 2.5 Flash Lite rejects low's 256-token budget; high is the way out, and
    // it is reached even from a level the table no longer lists.
    expect(stepUpThinkingLevel('gemini-2.5-flash-lite', 'low')).toBe('high');
    // It skips levels a family does not have.
    expect(stepUpThinkingLevel('gemini-2.5-flash', 'minimal')).toBe('low');
    expect(stepUpThinkingLevel('gemma-4-31b-it', 'minimal')).toBe('high');
  });

  it('returns null at the top of the ladder', () => {
    expect(stepUpThinkingLevel('gemini-3.8-flash', 'high')).toBeNull();
    expect(stepUpThinkingLevel('gemini-3.8-flash', null)).toBeNull();
  });
});

describe('resolveThinkingLevel', () => {
  it('keeps the configured level when the model accepts it', () => {
    expect(resolveThinkingLevel('gemini-3.8-flash', 'low')).toBe('low');
    expect(resolveThinkingLevel('gemini-3.8-flash', 'high')).toBe('high');
  });

  it('maps minimal onto the nearest level each family has', () => {
    expect(resolveThinkingLevel('gemini-3.8-flash', 'minimal')).toBe('low');
    expect(resolveThinkingLevel('gemini-2.5-flash', 'minimal')).toBe('low');
    expect(resolveThinkingLevel('gemini-2.5-flash-lite', 'minimal')).toBe('high');
    expect(resolveThinkingLevel('gemma-4-31b-it', 'minimal')).toBe('minimal');
  });

  it('never asks 2.5 Flash Lite for a level it cannot use', () => {
    for (const wanted of ['minimal', 'low', 'medium', 'high', undefined]) {
      expect(resolveThinkingLevel('gemini-2.5-flash-lite', wanted)).toBe('high');
    }
  });

  it('falls back to the nearest level Gemma accepts', () => {
    // Gemma allows only minimal and high: "low" is one rung from minimal and
    // two from high, so a request for cheap thinking stays cheap.
    expect(resolveThinkingLevel('gemma-4-31b-it', 'low')).toBe('minimal');
    expect(resolveThinkingLevel('gemma-4-31b-it', 'medium')).toBe('high');
    expect(resolveThinkingLevel('gemma-4-31b-it', 'high')).toBe('high');
  });

  it('defaults an unset or unrecognised level to low', () => {
    expect(resolveThinkingLevel('gemini-3.8-flash', undefined)).toBe('low');
    expect(resolveThinkingLevel('gemini-3.8-flash', 'turbo')).toBe('low');
  });
});

describe('parseAllowedThinkingLevels', () => {
  it('reads the levels out of the API complaint', () => {
    expect(
      parseAllowedThinkingLevels(
        "'low' is not a supported thinking level for this model. Allowed values are: high, minimal."
      )
    ).toEqual(['high', 'minimal']);
  });

  it('returns nothing when the message does not name any', () => {
    expect(
      parseAllowedThinkingLevels('Request contains an invalid argument.')
    ).toEqual([]);
  });
});
