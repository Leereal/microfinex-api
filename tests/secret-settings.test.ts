import {
  isSecretSettingKey,
  redactSecretSettings,
  reservedSettingEndpoint,
} from '../src/utils/secret-settings';

/**
 * The general settings API is readable by any signed-in user. These make sure
 * an integration's credential never rides along with the currency and
 * workflow toggles it returns.
 */

describe('credential settings', () => {
  it('recognises credentials by their suffix', () => {
    expect(isSecretSettingKey('obse_api_key')).toBe(true);
    expect(isSecretSettingKey('SMS_GATEWAY_SECRET')).toBe(true);
    expect(isSecretSettingKey('smtp_password')).toBe(true);
    expect(isSecretSettingKey('webhook_token')).toBe(true);
  });

  it('leaves ordinary settings alone', () => {
    expect(isSecretSettingKey('obse_enabled')).toBe(false);
    expect(isSecretSettingKey('default_currency')).toBe(false);
    expect(isSecretSettingKey('api_key_rotation_days')).toBe(false);
  });

  it('strips credentials from a settings map', () => {
    const settings = {
      default_currency: 'USD',
      obse_enabled: true,
      obse_api_key: 'omse_secret',
    };
    expect(redactSecretSettings(settings)).toEqual({
      default_currency: 'USD',
      obse_enabled: true,
    });
  });
});

describe('integration-owned settings', () => {
  it('sends OBSE settings to their own endpoint', () => {
    expect(reservedSettingEndpoint('obse_enabled')).toBe('/api/v1/obse/settings');
    expect(reservedSettingEndpoint('OBSE_BASE_URL')).toBe('/api/v1/obse/settings');
  });

  it('does not reserve anything else', () => {
    expect(reservedSettingEndpoint('default_currency')).toBeNull();
  });
});
