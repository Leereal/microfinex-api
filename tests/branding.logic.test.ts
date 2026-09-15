import {
  DEFAULT_BRANDING,
  brandingUpdateSchema,
  buildPalette,
  changedFields,
  normaliseStored,
  presentBranding,
  sniffImageType,
  unsafeSvgReason,
  validateAsset,
} from '../src/services/branding/branding.logic';
import { compileTemplate } from '../src/templates/notification.templates';
import { setBrandName } from '../src/services/branding/branding.cache';

/**
 * White-label branding. What matters: the default looks exactly as the app
 * always has, a stored record can never break a page, and an uploaded logo can
 * never carry script.
 */

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const svg = (inner = '<circle cx="5" cy="5" r="4" fill="url(#g)"/>') =>
  Buffer.from(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`);

describe('stored branding', () => {
  it('falls back to MicroSteward when nothing is stored', () => {
    const stored = normaliseStored(null);
    expect(stored.productName).toBe('MicroSteward');
    expect(stored.landingPage).toBe('steward');
  });

  it('repairs a damaged record instead of failing', () => {
    const stored = normaliseStored({ productName: '  ', brandColor: 'green', landingPage: 'nonsense', assets: { logo: { path: 5 } } });
    expect(stored.productName).toBe(DEFAULT_BRANDING.productName);
    expect(stored.brandColor).toBeNull();
    expect(stored.landingPage).toBe('steward');
    expect(stored.assets).toEqual({});
  });

  it('keeps a cleared tagline cleared, but gives a never-set one the default', () => {
    expect(normaliseStored({ productName: 'X Co' }).tagline).toBe(DEFAULT_BRANDING.tagline);
    expect(normaliseStored({ productName: 'X Co', tagline: null }).tagline).toBeNull();
  });
});

describe('editing', () => {
  const valid = { productName: ' Acme Lending ', landingPage: 'classic', supportEmail: '', brandColor: '#6D28D9' };

  it('trims, empties blanks and lower-cases the colour', () => {
    const parsed = brandingUpdateSchema.parse(valid);
    expect(parsed.productName).toBe('Acme Lending');
    expect(parsed.supportEmail).toBeNull();
    expect(parsed.brandColor).toBe('#6d28d9');
  });

  it('refuses what would break the product', () => {
    expect(brandingUpdateSchema.safeParse({ ...valid, productName: 'A' }).success).toBe(false);
    expect(brandingUpdateSchema.safeParse({ ...valid, landingPage: 'marketing' }).success).toBe(false);
    expect(brandingUpdateSchema.safeParse({ ...valid, brandColor: 'purple' }).success).toBe(false);
    expect(brandingUpdateSchema.safeParse({ ...valid, websiteUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(brandingUpdateSchema.safeParse({ ...valid, supportEmail: 'help@' }).success).toBe(false);
    expect(brandingUpdateSchema.safeParse({ ...valid, assets: {} }).success).toBe(false);
  });

  it('lists what changed for the audit log', () => {
    const before = normaliseStored({ productName: 'A Co' });
    expect(changedFields(before, { ...before, productName: 'B Co', landingPage: 'classic' })).toEqual(['productName', 'landingPage']);
  });
});

describe('colour', () => {
  it('reproduces the default green exactly', () => {
    const { shades, secondary } = buildPalette(null);
    expect(shades['900']).toBe('#064e3b');
    expect(shades['600']).toBe('#059669');
    expect(secondary).toBe('#0f766e');
  });

  it('builds light-to-dark shades that keep the hue', () => {
    const { shades } = buildPalette('#6d28d9');
    const lightness = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lightness(shades['50'])).toBeGreaterThan(lightness(shades['500']));
    expect(lightness(shades['500'])).toBeGreaterThan(lightness(shades['950']));
    // Purple: blue and red above green.
    const [r, g, b] = rgb(shades['700']);
    expect(b).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(g);
  });

  it('keeps the dark end dark even for a pale brand colour, so white text still reads', () => {
    const { shades } = buildPalette('#fde68a');
    const [r, g, b] = rgb(shades['900']);
    expect((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255).toBeLessThan(0.3);
  });
});

describe('uploaded logos', () => {
  it('knows a file by its bytes, not its name', () => {
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from([0, 0, 1, 0, 1, 0]))).toBe('image/x-icon');
    expect(sniffImageType(svg())).toBe('image/svg+xml');
    expect(sniffImageType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
  });

  it('accepts a plain SVG with gradients', () => {
    expect(unsafeSvgReason(svg().toString())).toBeNull();
    expect(validateAsset('logo', svg())).toBe('image/svg+xml');
  });

  it.each([
    ['<script>alert(1)</script>', 'a script'],
    ['<rect onload="alert(1)"/>', 'event handlers'],
    ['<a href="javascript:alert(1)"><rect/></a>', 'script links'],
    ['<foreignObject><div/></foreignObject>', 'embedded HTML'],
    ['<image href="https://tracker.example/x.png"/>', 'links to other files'],
    ['<style>@import "https://evil.example/x.css";</style>', 'styles loaded from elsewhere'],
  ])('refuses an SVG containing %s', (inner, reason) => {
    expect(unsafeSvgReason(svg(inner).toString())).toContain(reason);
    expect(() => validateAsset('logo', svg(inner))).toThrow(/not allowed in a logo/);
  });

  it('refuses entity declarations', () => {
    expect(unsafeSvgReason('<!DOCTYPE svg [<!ENTITY a "x">]><svg/>')).toContain('entity');
  });

  it('holds each slot to its own types and size', () => {
    expect(() => validateAsset('mark', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toThrow(/SVG, PNG, WEBP/);
    expect(validateAsset('favicon', Buffer.from([0, 0, 1, 0, 1, 0]))).toBe('image/x-icon');
    expect(() => validateAsset('favicon', Buffer.concat([png, Buffer.alloc(600 * 1024)]))).toThrow(/512KB/);
    expect(() => validateAsset('logo', Buffer.alloc(0))).toThrow(/empty/);
  });
});

describe('what visitors see', () => {
  it('never exposes storage paths', () => {
    const stored = normaliseStored({
      productName: 'Acme Lending',
      assets: { logo: { path: 'platform/branding/logo/secret.svg', mimeType: 'image/svg+xml', size: 10, hash: 'abcdef0123456789abcdef', uploadedAt: '' } },
    });
    const view = presentBranding(stored);
    expect(JSON.stringify(view)).not.toContain('platform/branding');
    expect(view.assets.logo).toEqual({ custom: true, url: '/api/v1/public/branding/assets/logo?v=abcdef012345' });
    expect(view.assets.mark).toEqual({ custom: false, url: null });
    expect(view.companyName).toBe('Acme Lending');
    expect(view.colors.primary).toBe('6 78 59');
  });
});

describe('messages use the current name', () => {
  afterEach(() => setBrandName('MicroSteward'));

  it('fills {{ brandName }} from the branding, unless the caller gives one', () => {
    setBrandName('Acme Lending');
    expect(compileTemplate('Thank you for choosing {{ brandName }}.', {})).toBe('Thank you for choosing Acme Lending.');
    expect(compileTemplate('From {{ brandName }}', { brandName: 'Branch Co' })).toBe('From Branch Co');
  });
});
