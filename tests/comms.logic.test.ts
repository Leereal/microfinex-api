import crypto from 'crypto';
import {
  buildEmailHtml,
  clickToChatUrl,
  interpretBulkSmsResponse,
  interpretWhatsAppResponse,
  isOptOutKeyword,
  isOptedOut,
  isStatusAdvance,
  mapWhatsAppStatus,
  normaliseEmail,
  normalisePhone,
  renderTemplate,
  resolveAddress,
  retryDelayMs,
  signUnsubscribeToken,
  smsSegments,
  verifyMetaSignature,
  verifyUnsubscribeToken,
} from '../src/services/communications/comms.logic';

/**
 * The rules of client communications. Provider response fixtures follow the
 * BulkSMS OpenAPI specification and the WhatsApp Cloud API reference.
 */

describe('phone numbers', () => {
  it('keeps an international number as it is', () => {
    expect(normalisePhone('+27 83 123 4567', '263')).toBe('+27831234567');
    expect(normalisePhone('00263771234567', '27')).toBe('+263771234567');
  });

  it('gives a local number the organization’s country code', () => {
    expect(normalisePhone('083 123 4567', '27')).toBe('+27831234567');
    expect(normalisePhone('831234567', '27')).toBe('+27831234567');
    expect(normalisePhone('0771234567', '263')).toBe('+263771234567');
  });

  it('does not add the country code twice', () => {
    expect(normalisePhone('27831234567', '27')).toBe('+27831234567');
  });

  it('refuses what cannot be a phone number', () => {
    expect(normalisePhone('12345', '27')).toBeNull();
    expect(normalisePhone('+1234567890123456', '27')).toBeNull();
    expect(normalisePhone('', '27')).toBeNull();
    // A local number with no country to put in front of it.
    expect(normalisePhone('0831234567', null)).toBeNull();
  });

  it('builds a click-to-chat link without the plus', () => {
    expect(clickToChatUrl('+27831234567', 'Hi Rudo & co')).toBe('https://wa.me/27831234567?text=Hi%20Rudo%20%26%20co');
  });
});

describe('email addresses', () => {
  it('accepts and lower-cases a real address', () => {
    expect(normaliseEmail(' Rudo.Banda@Example.co.za ')).toBe('rudo.banda@example.co.za');
  });
  it('refuses a malformed one', () => {
    expect(normaliseEmail('rudo@')).toBeNull();
    expect(normaliseEmail('rudo example.com')).toBeNull();
    expect(normaliseEmail('a@b')).toBeNull();
  });
});

describe('choosing the address', () => {
  const client = {
    email: null,
    phone: '0831111111',
    contacts: [
      { contactType: 'MOBILE', contactValue: '+27832222222', isPrimary: true, isWhatsApp: false },
      { contactType: 'MOBILE', contactValue: '+27833333333', isPrimary: false, isWhatsApp: true },
      { contactType: 'EMAIL', contactValue: 'rudo@example.com', isPrimary: false, isWhatsApp: false },
    ],
  };

  it('uses the primary mobile for SMS', () => {
    expect(resolveAddress('SMS', client, '27')).toBe('+27832222222');
  });
  it('prefers the number marked as WhatsApp', () => {
    expect(resolveAddress('WHATSAPP', client, '27')).toBe('+27833333333');
  });
  it('falls back to an email contact when the client has no email', () => {
    expect(resolveAddress('EMAIL', client, '27')).toBe('rudo@example.com');
  });
  it('skips unusable values and finds the next', () => {
    expect(resolveAddress('SMS', { phone: 'n/a', contacts: [{ contactType: 'MOBILE', contactValue: '0834444444', isPrimary: false, isWhatsApp: false }] }, '27')).toBe('+27834444444');
  });
  it('returns nothing when there is nothing', () => {
    expect(resolveAddress('EMAIL', { phone: '0831111111' }, '27')).toBeNull();
  });
});

describe('opt-outs', () => {
  const prefs = { emailOptOut: true, smsOptOut: false, whatsappOptOut: false };
  it('is per channel', () => {
    expect(isOptedOut('EMAIL', prefs)).toBe(true);
    expect(isOptedOut('SMS', prefs)).toBe(false);
    expect(isOptedOut('WHATSAPP', null)).toBe(false);
  });
  it('recognises a STOP reply', () => {
    expect(isOptOutKeyword('STOP')).toBe(true);
    expect(isOptOutKeyword(' unsubscribe ')).toBe(true);
    expect(isOptOutKeyword('Opt-out!')).toBe(true);
    expect(isOptOutKeyword('please stop calling me at work')).toBe(false);
  });
});

describe('placeholders', () => {
  it('fills known values', () => {
    expect(renderTemplate('Hi {{firstName}}, your balance is {{ outstandingBalance }}.', { firstName: 'Rudo', outstandingBalance: 'ZAR 450.00' }).text).toBe(
      'Hi Rudo, your balance is ZAR 450.00.'
    );
  });
  it('reports a placeholder this client has no value for', () => {
    const result = renderTemplate('Loan {{loanNumber}}', { firstName: 'Rudo' });
    expect(result.missing).toEqual(['loanNumber']);
    expect(result.text).toBe('Loan ');
  });
  it('reports an unknown placeholder instead of dropping it silently', () => {
    expect(renderTemplate('Hi {{nickname}}', {}).unknown).toEqual(['nickname']);
  });
});

describe('SMS length', () => {
  it('fits 160 GSM characters in one part', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'GSM', length: 160, parts: 1 });
    expect(smsSegments('a'.repeat(161)).parts).toBe(2);
  });
  it('counts GSM extension characters twice', () => {
    expect(smsSegments('€'.repeat(80)).length).toBe(160);
  });
  it('switches to Unicode for an emoji, at 70 per part', () => {
    expect(smsSegments('Thanks 🙏').encoding).toBe('UNICODE');
    expect(smsSegments('é🙏'.repeat(40)).parts).toBe(2);
  });
});

describe('email HTML', () => {
  it('escapes what staff type, so nothing pasted becomes markup', () => {
    const html = buildEmailHtml({ body: '<script>alert(1)</script>\nLine two', organizationName: 'OMS & Co' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('OMS &amp; Co');
    expect(html).toContain('<br>Line two');
  });
  it('adds the unsubscribe link only when given one', () => {
    expect(buildEmailHtml({ body: 'x', organizationName: 'OMS' })).not.toContain('Unsubscribe');
    expect(buildEmailHtml({ body: 'x', organizationName: 'OMS', unsubscribeUrl: 'https://api/x?token=a' })).toContain('Unsubscribe from these emails');
  });
});

describe('unsubscribe links', () => {
  const secret = 'test-secret';
  const claims = { organizationId: 'org-1', clientId: 'client-1', channel: 'EMAIL' as const };

  it('round-trips', () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(claims, secret), secret)).toEqual(claims);
  });
  it('cannot be altered to opt out someone else', () => {
    const token = signUnsubscribeToken(claims, secret);
    const [, signature] = token.split('.');
    const forged = `${Buffer.from('org-1.client-2.EMAIL').toString('base64url')}.${signature}`;
    expect(verifyUnsubscribeToken(forged, secret)).toBeNull();
  });
  it('is refused under a different secret, or when mangled', () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(claims, secret), 'other')).toBeNull();
    expect(verifyUnsubscribeToken('nonsense', secret)).toBeNull();
  });
});

describe('Meta webhook signatures', () => {
  const body = Buffer.from('{"entry":[]}');
  const good = `sha256=${crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
  it('accepts a correct signature', () => {
    expect(verifyMetaSignature(body, good, 'app-secret')).toBe(true);
  });
  it('refuses a wrong or missing one', () => {
    expect(verifyMetaSignature(body, good, 'other-secret')).toBe(false);
    expect(verifyMetaSignature(Buffer.from('{"entry":[1]}'), good, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, undefined, 'app-secret')).toBe(false);
  });
});

describe('BulkSMS replies', () => {
  it('reads an accepted message', () => {
    const outcome = interpretBulkSmsResponse(201, [{ id: '1234', status: { id: 'ACCEPTED.null', type: 'ACCEPTED', subtype: null } }]);
    expect(outcome).toMatchObject({ ok: true, providerMessageId: '1234', status: 'SENT' });
  });
  it('explains an immediate failure by its subtype', () => {
    const outcome = interpretBulkSmsResponse(201, [{ id: '9', status: { type: 'FAILED', subtype: 'BLOCKED' } }]);
    expect(outcome).toMatchObject({ ok: false, errorCode: 'BULKSMS_BLOCKED', retryable: false });
    expect(outcome.errorMessage).toMatch(/blocked/);
  });
  it('reads the problem document on refusal', () => {
    const outcome = interpretBulkSmsResponse(401, { type: 'https://developer.bulksms.com/json/v1/errors#authentication-failed', title: 'Authentication Failed', status: 401, detail: 'Full authentication is required to access this resource' });
    expect(outcome).toMatchObject({ ok: false, errorCode: 'BULKSMS_AUTH', retryable: false });
  });
  it('retries rate limits and outages, not bad requests', () => {
    expect(interpretBulkSmsResponse(429, {}).retryable).toBe(true);
    expect(interpretBulkSmsResponse(503, {}).retryable).toBe(true);
    expect(interpretBulkSmsResponse(400, { detail: 'bad number' }).retryable).toBe(false);
  });
});

describe('WhatsApp replies', () => {
  it('reads a sent message', () => {
    expect(interpretWhatsAppResponse(200, { messaging_product: 'whatsapp', contacts: [{ input: '27831234567', wa_id: '27831234567' }], messages: [{ id: 'wamid.ABC' }] })).toMatchObject({ ok: true, providerMessageId: 'wamid.ABC', status: 'SENT' });
  });
  it('explains the 24-hour window', () => {
    const outcome = interpretWhatsAppResponse(400, { error: { code: 131047, message: 'Re-engagement message' } });
    expect(outcome.errorCode).toBe('WHATSAPP_131047');
    expect(outcome.errorMessage).toMatch(/24 hours/);
  });
  it('retries throttling', () => {
    expect(interpretWhatsAppResponse(400, { error: { code: 130429 } }).retryable).toBe(true);
  });
  it('maps webhook statuses and only ever moves forward', () => {
    expect(mapWhatsAppStatus('read')).toBe('READ');
    expect(mapWhatsAppStatus('deleted')).toBeNull();
    expect(isStatusAdvance('SENT', 'DELIVERED')).toBe(true);
    expect(isStatusAdvance('READ', 'DELIVERED')).toBe(false);
    expect(isStatusAdvance('SENT', 'FAILED')).toBe(true);
    expect(isStatusAdvance('DELIVERED', 'FAILED')).toBe(false);
  });
});

it('backs off between retries, capped at 30 minutes', () => {
  expect(retryDelayMs(1)).toBe(60_000);
  expect(retryDelayMs(2)).toBe(120_000);
  expect(retryDelayMs(10)).toBe(30 * 60_000);
});
