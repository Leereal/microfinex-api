/**
 * Settings that must never be read back through the general settings API.
 *
 * `GET /settings` returns every organization setting to any signed-in user -
 * reasonable for a currency or a workflow toggle, but it would hand a
 * third-party API key to a teller. Anything that looks like a credential is
 * stripped from those responses; the integration that owns it exposes only
 * whether one is configured, never the value.
 *
 * Matched by suffix rather than by listing each key, so a credential added
 * later is protected without anyone remembering to add it here.
 */

const SECRET_SUFFIXES = ['_api_key', '_secret', '_password', '_token', '_private_key'];

export function isSecretSettingKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_SUFFIXES.some(suffix => lower.endsWith(suffix));
}

/**
 * Settings owned by a dedicated integration endpoint.
 *
 * Writing these through the general `PUT /settings/:key` would skip whatever
 * that endpoint does on the way in - encrypting the key, validating it - so
 * the general endpoint refuses them and points at the right one.
 */
const RESERVED_PREFIXES: Array<{ prefix: string; endpoint: string }> = [
  { prefix: 'obse_', endpoint: '/api/v1/obse/settings' },
  { prefix: 'comms_', endpoint: '/api/v1/communications/settings' },
];

export function reservedSettingEndpoint(key: string): string | null {
  const match = RESERVED_PREFIXES.find(entry =>
    key.toLowerCase().startsWith(entry.prefix)
  );
  return match?.endpoint ?? null;
}

/** A settings map with every credential removed. */
export function redactSecretSettings<T extends Record<string, unknown>>(
  settings: T
): T {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!isSecretSettingKey(key)) safe[key] = value;
  }
  return safe as T;
}
