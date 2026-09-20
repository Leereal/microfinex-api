/**
 * The schemas the tools are described to the models with.
 *
 * This exists because of a real failure: the OpenAPI dialect writes a positive
 * number as `{ minimum: 0, exclusiveMinimum: true }`, Gemini requires that
 * field to be a number, and it refused every request carrying a tool that took
 * an amount - "value at properties.amount.exclusiveMinimum must be a number".
 * One malformed keyword in one tool takes down the whole conversation, so the
 * generated schemas are checked here rather than in front of a user.
 */

jest.mock('../src/services/cache.service', () => ({
  cacheService: { invalidateClientsCache: jest.fn(), connect: jest.fn(), disconnect: jest.fn() },
}));

jest.mock('../src/config/database', () => ({ prisma: {} }));

import { z } from 'zod';
import { readTools } from '../src/services/assistant/tools/read.tools';
import { writeTools } from '../src/services/assistant/tools/write.tools';
import { normaliseSchema, toolSpec } from '../src/services/assistant/tools/tool-kit';
import { geminiSchema } from '../src/services/assistant/assistant.models';

const allTools = [...readTools, ...writeTools];

/** Every object in a schema, however deeply nested. */
function walk(node: unknown, visit: (entry: Record<string, unknown>) => void) {
  if (Array.isArray(node)) {
    node.forEach(entry => walk(entry, visit));
    return;
  }
  if (!node || typeof node !== 'object') return;
  visit(node as Record<string, unknown>);
  Object.values(node as Record<string, unknown>).forEach(value => walk(value, visit));
}

describe('what every tool hands the model', () => {
  it.each(allTools.map(tool => [tool.name, tool] as const))('%s describes an object', (_name, tool) => {
    const spec = toolSpec(tool);
    expect(spec.parameters.type).toBe('object');
    expect(spec.parameters).toHaveProperty('properties');
    expect(spec.description.length).toBeGreaterThan(10);
  });

  it('never writes an exclusive bound as a boolean', () => {
    for (const tool of allTools) {
      walk(toolSpec(tool).parameters, entry => {
        expect(typeof entry.exclusiveMinimum).not.toBe('boolean');
        expect(typeof entry.exclusiveMaximum).not.toBe('boolean');
      });
    }
  });

  it('keeps an amount usable: positive numbers survive as a numeric bound', () => {
    const application = allTools.find(tool => tool.name === 'create_loan_application')!;
    const properties = (toolSpec(application).parameters.properties ?? {}) as Record<string, Record<string, unknown>>;
    expect(properties.amount).toMatchObject({ type: 'number', exclusiveMinimum: 0 });
  });

  it('carries no JSON Schema plumbing the providers do not want', () => {
    for (const tool of allTools) {
      const spec = toolSpec(tool);
      expect(spec.parameters).not.toHaveProperty('$schema');
      expect(spec.parameters).not.toHaveProperty('definitions');
      expect(JSON.stringify(spec.parameters)).not.toContain('$ref');
    }
  });
});

describe('converting an older dialect', () => {
  it('turns a draft-4 exclusive bound into a number', () => {
    expect(normaliseSchema({ type: 'number', minimum: 0, exclusiveMinimum: true })).toEqual({
      type: 'number',
      exclusiveMinimum: 0,
    });
  });

  it('drops an exclusive flag that has no bound to stand on', () => {
    expect(normaliseSchema({ type: 'number', exclusiveMinimum: true })).toEqual({ type: 'number' });
    expect(normaliseSchema({ type: 'number', minimum: 1, exclusiveMinimum: false })).toEqual({
      type: 'number',
      minimum: 1,
    });
  });

  it('reaches into nested properties and arrays', () => {
    const converted = normaliseSchema({
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'number', minimum: 0, exclusiveMinimum: true } } },
    }) as unknown as Record<string, unknown>;
    expect(JSON.stringify(converted)).toContain('"exclusiveMinimum":0');
    expect(JSON.stringify(converted)).not.toContain('"minimum"');
  });
});

describe('the subset Gemini accepts', () => {
  it('drops what it refuses and keeps what it needs', () => {
    const converted = geminiSchema({
      type: 'object',
      additionalProperties: false,
      $schema: 'http://json-schema.org/draft-07/schema#',
      properties: {
        clientId: { type: 'string', format: 'uuid', description: 'The client' },
        when: { type: 'string', format: 'date-time' },
        amount: { type: 'number', exclusiveMinimum: 0 },
        channel: { type: 'string', enum: ['EMAIL', 'SMS'] },
      },
      required: ['clientId'],
    }) as unknown as Record<string, unknown>;

    const text = JSON.stringify(converted);
    expect(text).not.toContain('additionalProperties');
    expect(text).not.toContain('$schema');
    // An unknown format is dropped; a known one is kept.
    expect(text).not.toContain('uuid');
    expect(text).toContain('date-time');
    // An exclusive bound becomes the inclusive one rather than an error.
    expect(text).toContain('"minimum":0');
    expect(text).toContain('EMAIL');
    expect(text).toContain('"required":["clientId"]');
  });

  it('turns a choice of shapes into anyOf, and a fixed value into an enum', () => {
    expect(geminiSchema({ oneOf: [{ type: 'string' }] })).toEqual({ anyOf: [{ type: 'string' }] });
    expect(geminiSchema({ const: 'CLIENT' })).toEqual({ enum: ['CLIENT'] });
  });

  it('leaves every real tool with something Gemini will take', () => {
    for (const tool of allTools) {
      const converted = geminiSchema(toolSpec(tool).parameters);
      const text = JSON.stringify(converted);
      expect(text).not.toContain('additionalProperties');
      expect(text).not.toContain('exclusiveMinimum');
      expect(text).not.toContain('"format":"uuid"');
      expect(text).not.toContain('"format":"email"');
      expect(converted).toHaveProperty('type', 'object');
      // The field names must survive: a tool whose properties were stripped
      // looks to the model like a tool that takes no arguments.
      const original = Object.keys((toolSpec(tool).parameters.properties ?? {}) as object);
      const kept = Object.keys(((converted as { properties?: object }).properties ?? {}) as object);
      expect(kept.sort()).toEqual(original.sort());
    }
  });

  it('is not fooled by a schema that only looks like one', () => {
    // An MCP server may publish anything; nothing here should throw.
    expect(() => geminiSchema(null)).not.toThrow();
    expect(() => geminiSchema({ properties: { odd: z.string() } })).not.toThrow();
  });
});

describe('what a client record cannot be created without', () => {
  const { missingClientFields } = require('../src/services/assistant/tools/write.tools') as {
    missingClientFields: (args: Record<string, unknown>) => string[];
  };

  it('asks for the name an individual has to have', () => {
    expect(missingClientFields({ type: 'INDIVIDUAL', phone: '+263771234567' })).toEqual([
      'firstName',
      'lastName',
    ]);
  });

  it('asks a business for its business name instead', () => {
    expect(missingClientFields({ type: 'BUSINESS', phone: '+263771234567' })).toEqual(['businessName']);
    expect(missingClientFields({ type: 'BUSINESS', businessName: 'Kudu Traders', phone: '+263771234567' })).toEqual([]);
  });

  it('treats a phone number that is too short as missing', () => {
    expect(missingClientFields({ type: 'INDIVIDUAL', firstName: 'Ada', lastName: 'Ncube', phone: '123' })).toEqual([
      'phone',
    ]);
    expect(missingClientFields({ type: 'INDIVIDUAL', firstName: 'Ada', lastName: 'Ncube' })).toEqual(['phone']);
  });

  it('is satisfied by a complete individual', () => {
    expect(
      missingClientFields({ type: 'INDIVIDUAL', firstName: 'Ada', lastName: 'Ncube', phone: '+27 65 174 9011' })
    ).toEqual([]);
  });

  it('does not count whitespace as an answer', () => {
    expect(missingClientFields({ type: 'INDIVIDUAL', firstName: '  ', lastName: 'Ncube', phone: '+263771234567' })).toEqual([
      'firstName',
    ]);
  });
});

describe('telling somebody what went wrong', () => {
  const { describeFailure } = require('../src/services/assistant/assistant.logic') as {
    describeFailure: (error: unknown) => string;
  };

  it('turns a validation failure into a sentence, not JSON', () => {
    const { z } = require('zod');
    const schema = z.object({ phone: z.string().min(9) });
    const result = schema.safeParse({ phone: '12' });
    const described = describeFailure(result.error);
    expect(described).toContain('phone');
    expect(described).not.toContain('"code"');
    expect(described).not.toContain('[{');
  });

  it('keeps a plain error as it is', () => {
    expect(describeFailure(new Error('The mailbox could not be reached.'))).toBe(
      'The mailbox could not be reached.'
    );
  });

  it('says something useful when handed nothing', () => {
    expect(describeFailure(undefined)).toBe('It could not be carried out.');
  });
});
