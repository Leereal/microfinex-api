/**
 * Jest setup.
 *
 * The unit suites here exercise pure calculation logic and must not reach a
 * database, so no client is initialised. Secrets are stubbed because importing
 * src/config throws when JWT secrets are absent.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-not-used-outside-tests';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-not-used-outside-tests';
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/microfinex_test';

jest.setTimeout(15000);

export {};
