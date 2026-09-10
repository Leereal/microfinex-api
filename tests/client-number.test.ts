import { clientService } from '../src/services/client.service';

/**
 * Client numbers are allocated by the server, so a collision is never
 * something the operator can act on - it reached them as "A client with this
 * client number already exists" on a brand new client. The generator now
 * derives from the highest number issued rather than a row count, and the
 * create retries past a number that is taken anyway.
 */
const service = clientService as any;

describe('isClientNumberCollision', () => {
  it('recognises an array target', () => {
    expect(
      service.isClientNumberCollision({
        code: 'P2002',
        meta: { target: ['clientNumber'] },
      })
    ).toBe(true);
  });

  it('recognises a raw constraint name', () => {
    expect(
      service.isClientNumberCollision({
        code: 'P2002',
        meta: { target: 'clients_clientNumber_key' },
      })
    ).toBe(true);
  });

  it('falls back to the message when meta is empty', () => {
    expect(
      service.isClientNumberCollision({
        code: 'P2002',
        meta: {},
        message: 'Unique constraint failed on the fields: (`clientNumber`)',
      })
    ).toBe(true);
  });

  it('does not claim a duplicate phone as its own', () => {
    // Retrying a duplicate phone would just repeat the same failure while
    // hiding the real reason from the operator.
    expect(
      service.isClientNumberCollision({
        code: 'P2002',
        meta: { target: ['phone'] },
      })
    ).toBe(false);
  });

  it('ignores errors that are not unique-constraint violations', () => {
    expect(
      service.isClientNumberCollision({
        code: 'P2025',
        meta: { target: ['clientNumber'] },
      })
    ).toBe(false);
    expect(service.isClientNumberCollision(new Error('boom'))).toBe(false);
    expect(service.isClientNumberCollision(null)).toBe(false);
  });
});
