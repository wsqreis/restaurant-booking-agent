import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { lenient } from '../src/llm/lenient.ts';

const schema = z.object({
  intent: z.enum(['book', 'other']),
  name: z.string().nullable(),
  partySize: z.number().int().nullable(),
  reservationCode: z.string().nullable(),
  tags: z.array(z.object({ value: z.string().nullable() })).optional(),
});

describe('lenient', () => {
  it('turns "None"-like strings into null', () => {
    const repaired = lenient(schema, { intent: 'book', name: 'None', partySize: 'null', reservationCode: 'N/A' });
    assert.deepEqual(schema.parse(repaired), { intent: 'book', name: null, partySize: null, reservationCode: null });
  });

  it('turns numeric strings into numbers only where the schema expects a number', () => {
    const repaired = lenient(schema, { intent: 'book', name: 'Ana', partySize: '4', reservationCode: '234567' });
    assert.deepEqual(schema.parse(repaired), { intent: 'book', name: 'Ana', partySize: 4, reservationCode: '234567' });
  });

  it('repairs nested arrays of objects', () => {
    const repaired = lenient(schema, { intent: 'other', name: null, partySize: null, reservationCode: null, tags: [{ value: 'none' }, { value: 'jazz' }] });
    assert.deepEqual((schema.parse(repaired) as { tags: unknown }).tags, [{ value: null }, { value: 'jazz' }]);
  });

  it('leaves enum values alone, so an invalid one still fails validation', () => {
    assert.throws(() => schema.parse(lenient(schema, { intent: 'None', name: null, partySize: null, reservationCode: null })));
  });
});
