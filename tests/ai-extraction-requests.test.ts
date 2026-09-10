import { aiExtractionService } from '../src/services/ai-extraction.service';

/**
 * `callGemini` adapts a request to what a model accepts, and reads a response
 * back even when the model wrapped it in markdown. Both are reached through
 * private helpers - exercised here directly, since the alternative is a live
 * call to Google.
 */
const service = aiExtractionService as any;

describe('parseModelJson', () => {
  it('parses a plain JSON object', () => {
    expect(service.parseModelJson('{"first_name":"Tendai"}')).toEqual({
      first_name: 'Tendai',
    });
  });

  it('parses JSON wrapped in a markdown fence', () => {
    // What gemini-2.5-flash-lite returns, and what JSON.parse choked on.
    const fenced = '```json\n{ "first_name": "Tendai", "id_number": "63-1X12" }\n```';
    expect(service.parseModelJson(fenced)).toEqual({
      first_name: 'Tendai',
      id_number: '63-1X12',
    });
  });

  it('parses JSON with commentary around it', () => {
    const chatty =
      'Here is the extracted data:\n{"first_name":"Rudo"}\nLet me know if you need more.';
    expect(service.parseModelJson(chatty)).toEqual({ first_name: 'Rudo' });
  });

  it('reports the response when there is no JSON in it at all', () => {
    expect(() => service.parseModelJson('I cannot read this document.')).toThrow(
      /not valid JSON/
    );
  });
});

describe('planGeminiRetry', () => {
  const thinkingComplaint =
    "'low' is not a supported thinking level for this model. Allowed values are: high, minimal.";
  const invalidArgument = 'Request contains an invalid argument.';

  it('retries with a thinking level the model named', () => {
    const plan = service.planGeminiRetry(thinkingComplaint, 'gemma-4-31b-it', {
      useSchema: false,
      thinkingLevel: 'low',
      resolution: null,
    });
    expect(plan).toMatchObject({ thinkingLevel: 'high' });
  });

  it('drops the thinking level when the model names none', () => {
    const plan = service.planGeminiRetry('thinking_level is not supported', 'gemma-4-31b-it', {
      useSchema: false,
      thinkingLevel: 'low',
      resolution: null,
    });
    expect(plan).toMatchObject({ thinkingLevel: null });
  });

  it('steps the image resolution down first', () => {
    // The measured cause of the Gemma failure. Giving up a rung of image
    // fidelity is cheaper than giving up the schema.
    const plan = service.planGeminiRetry(invalidArgument, 'gemma-4-31b-it', {
      useSchema: true,
      thinkingLevel: 'minimal',
      resolution: 'ultra_high',
    });
    expect(plan).toMatchObject({
      resolution: 'high',
      useSchema: true,
      thinkingLevel: 'minimal',
    });
  });

  it('keeps stepping down, then drops the resolution entirely', () => {
    const rungs = ['ultra_high', 'high', 'medium', 'low'];
    const results = rungs.map(
      resolution =>
        service.planGeminiRetry(invalidArgument, 'gemma-4-31b-it', {
          useSchema: false,
          thinkingLevel: null,
          resolution,
        })?.resolution
    );
    expect(results).toEqual(['high', 'medium', 'low', null]);
  });

  it('drops the response schema once the resolution is gone', () => {
    const plan = service.planGeminiRetry(invalidArgument, 'gemma-4-31b-it', {
      useSchema: true,
      thinkingLevel: 'minimal',
      resolution: null,
    });
    expect(plan).toMatchObject({ useSchema: false, thinkingLevel: 'minimal' });
  });

  it('gives up rather than looping once nothing is left to drop', () => {
    expect(
      service.planGeminiRetry(invalidArgument, 'gemma-4-31b-it', {
        useSchema: false,
        thinkingLevel: null,
        resolution: null,
      })
    ).toBeNull();
  });

  it('thinks harder when the implied budget is below the model floor', () => {
    // Gemini 2.5 Flash Lite: "The thinking budget 256 is invalid. Please choose
    // a value between 512 and 24576." low is supported, its budget is not.
    const plan = service.planGeminiRetry(
      'The thinking budget 256 is invalid. Please choose a value between 512 and 24576.',
      'gemini-2.5-flash-lite',
      { useSchema: true, thinkingLevel: 'low', resolution: 'ultra_high' }
    );
    expect(plan).toMatchObject({
      thinkingLevel: 'high',
      // Nothing else is given up for a budget complaint.
      useSchema: true,
      resolution: 'ultra_high',
    });
  });

  it('drops thinking when no higher level exists for a budget complaint', () => {
    const plan = service.planGeminiRetry(
      'The thinking budget 256 is invalid.',
      'gemini-2.5-flash-lite',
      { useSchema: true, thinkingLevel: 'high', resolution: null }
    );
    expect(plan).toMatchObject({ thinkingLevel: null });
  });

  it('does not retry a failure that is not about a request parameter', () => {
    expect(
      service.planGeminiRetry('API key not valid. Please pass a valid API key.', 'gemma-4-31b-it', {
        useSchema: true,
        thinkingLevel: 'low',
        resolution: 'ultra_high',
      })
    ).toBeNull();
  });

  it('does not retry a quota failure', () => {
    expect(
      service.planGeminiRetry('You exceeded your current quota.', 'gemma-4-31b-it', {
        useSchema: true,
        thinkingLevel: 'low',
        resolution: 'ultra_high',
      })
    ).toBeNull();
  });
});
