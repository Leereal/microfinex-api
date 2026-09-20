import { describeDuplicateClient } from '../src/utils/duplicate-client';

/**
 * The bug this covers: `meta.target?.[0] || 'field'` produced the message
 * "A client with this field already exists" whenever Prisma did not hand back
 * an array of column names - which is exactly what the driver adapter does.
 */
describe('describeDuplicateClient', () => {
  const p2002 = (meta: unknown, message = 'Unique constraint failed') => ({
    code: 'P2002',
    meta,
    message,
  });

  it('ignores anything that is not a unique-constraint violation', async () => {
    expect(
      await describeDuplicateClient({ code: 'P2025' }, {})
    ).toBeNull();
    expect(await describeDuplicateClient(new Error('boom'), {})).toBeNull();
  });

  it('reads an array of column names', async () => {
    const result = await describeDuplicateClient(
      p2002({ target: ['phone'] }),
      {}
    );
    expect(result).toMatchObject({ field: 'phone', fieldLabel: 'phone number' });
    expect(result!.message).toContain('phone number');
    expect(result!.message).not.toContain('this field');
  });

  it('reads a raw constraint name, which is what broke the message', async () => {
    const result = await describeDuplicateClient(
      p2002({ target: 'clients_phone_key' }),
      {}
    );
    expect(result).toMatchObject({ field: 'phone' });
  });

  it('reads an idNumber constraint', async () => {
    const result = await describeDuplicateClient(
      p2002({ target: 'clients_idNumber_key' }),
      {}
    );
    expect(result).toMatchObject({
      field: 'idNumber',
      fieldLabel: 'ID number',
      section: 'identification',
    });
  });

  it('falls back to the error text when meta carries nothing', async () => {
    const result = await describeDuplicateClient(
      p2002(undefined, 'Unique constraint failed on the fields: (`phone`)'),
      {}
    );
    expect(result).toMatchObject({ field: 'phone' });
  });

  it('gives up rather than guessing when nothing names a field', async () => {
    expect(
      await describeDuplicateClient(p2002({ target: [] }, 'nope'), {})
    ).toBeNull();
  });

  it('points the form at the section holding the field', async () => {
    const phone = await describeDuplicateClient(p2002({ target: ['phone'] }), {});
    const id = await describeDuplicateClient(
      p2002({ target: ['idNumber'] }),
      {}
    );
    expect(phone!.section).toBe('contacts');
    expect(id!.section).toBe('identification');
  });

  it('always offers advice naming what to change', async () => {
    const result = await describeDuplicateClient(p2002({ target: ['phone'] }), {});
    expect(result!.advice).toMatch(/different phone number/i);
  });
});
