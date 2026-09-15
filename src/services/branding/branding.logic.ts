/**
 * White-label branding: the rules, with no database or storage.
 *
 * The platform's name, logos, colour and landing page are one record that a
 * Super Admin controls. Everything a person sees - the landing page, sign-in,
 * the sidebar, emails, statements - reads from it, so renaming the product is
 * a settings change rather than a code change.
 */

import { z } from 'zod';

export const BRANDING_SETTING_KEY = 'platform_branding';

export const LANDING_PAGES = ['steward', 'classic', 'sign-in'] as const;
export type LandingPage = (typeof LANDING_PAGES)[number];

export const ASSET_KINDS = ['logo', 'logoDark', 'mark', 'favicon'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

type ImageType = 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/x-icon';

export const ASSET_RULES: Record<AssetKind, { label: string; help: string; types: ImageType[]; maxBytes: number }> = {
  logo: {
    label: 'Logo',
    help: 'The full logo, for light backgrounds. A wide SVG or PNG, at least 480px wide.',
    types: ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'],
    maxBytes: 2 * 1024 * 1024,
  },
  logoDark: {
    label: 'Logo on dark backgrounds',
    help: 'The full logo in light colours, for dark headers and the sign-in page.',
    types: ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'],
    maxBytes: 2 * 1024 * 1024,
  },
  mark: {
    label: 'Icon',
    help: 'The symbol on its own, square. Used in the sidebar and on small screens.',
    types: ['image/svg+xml', 'image/png', 'image/webp'],
    maxBytes: 1 * 1024 * 1024,
  },
  favicon: {
    label: 'Browser tab icon',
    help: 'A square SVG, PNG (at least 64px) or ICO. Leave empty to use the icon.',
    types: ['image/svg+xml', 'image/png', 'image/x-icon'],
    maxBytes: 512 * 1024,
  },
};

export const EXTENSIONS: Record<ImageType, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
};

export interface StoredAsset {
  path: string;
  mimeType: string;
  size: number;
  hash: string;
  uploadedAt: string;
}

export interface StoredBranding {
  productName: string;
  shortName: string | null;
  tagline: string | null;
  description: string | null;
  companyName: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  websiteUrl: string | null;
  address: string | null;
  /** The one colour everything else is derived from; null keeps the default green. */
  brandColor: string | null;
  landingPage: LandingPage;
  assets: Partial<Record<AssetKind, StoredAsset>>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_BRANDING: StoredBranding = {
  productName: 'MicroSteward',
  shortName: null,
  tagline: 'Microfinance, well kept.',
  description:
    'Loan management for microfinance institutions: clients, loans, disbursements, repayments, reporting and client communications in one place.',
  companyName: null,
  supportEmail: null,
  supportPhone: null,
  websiteUrl: null,
  address: null,
  brandColor: null,
  landingPage: 'steward',
  assets: {},
  updatedAt: null,
  updatedBy: null,
};

/** The original Microfinex look, kept so it can be switched back to in one click. */
export const CLASSIC_BRANDING: StoredBranding = {
  productName: 'Microfinex',
  shortName: null,
  tagline: 'Modern microfinance management platform. Empower your institution with powerful tools for growth.',
  description:
    'A comprehensive, cloud-based platform for managing loans, clients, payments, and operations. Built for microfinance institutions, SACCOs, and lending organizations of all sizes.',
  companyName: null,
  supportEmail: 'info@microfinex.loan',
  supportPhone: '+27 65 174 9011',
  websiteUrl: null,
  address: 'Pretoria, South Africa',
  brandColor: null,
  landingPage: 'classic',
  assets: {},
  updatedAt: null,
  updatedBy: null,
};

export class BrandingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus = 400
  ) {
    super(message);
    this.name = 'BrandingError';
  }
}

// ----------------------------------------------------------------- input
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform(value => (value ?? '').trim() || null);

export const brandingUpdateSchema = z
  .object({
    /** What Super Admins call this profile; visitors never see it. */
    label: optionalText(60),
    productName: z
      .string()
      .transform(value => value.trim())
      .pipe(z.string().min(2, 'The product name needs at least 2 characters.').max(40, 'Keep the product name to 40 characters.')),
    shortName: optionalText(20),
    tagline: optionalText(120),
    description: optionalText(240),
    companyName: optionalText(80),
    supportEmail: optionalText(160).refine(value => !value || z.string().email().safeParse(value).success, 'The support email is not a valid address.'),
    supportPhone: optionalText(30).refine(value => !value || /^[+\d][\d\s()-]{5,}$/.test(value), 'The support phone may contain only digits, spaces, brackets, dashes and a leading +.'),
    websiteUrl: optionalText(200).refine(value => !value || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(value), 'The website must start with http:// or https://.'),
    address: optionalText(160),
    brandColor: z
      .string()
      .nullish()
      .transform(value => (value ?? '').trim().toLowerCase() || null)
      .refine(value => !value || /^#[0-9a-f]{6}$/.test(value), 'The brand colour must be a hex colour like #059669.'),
    landingPage: z.enum(LANDING_PAGES),
  })
  .strict();

export type BrandingUpdate = z.infer<typeof brandingUpdateSchema>;

const text = (input: unknown) => (typeof input === 'string' && input.trim() ? input.trim() : null);

/** What is stored, made whole: anything missing or damaged falls back to `defaults`. */
export function normaliseStored(raw: unknown, defaults: StoredBranding = DEFAULT_BRANDING): StoredBranding {
  if (!raw || typeof raw !== 'object') return { ...defaults, assets: {} };
  const value = raw as Partial<StoredBranding>;
  const assets: Partial<Record<AssetKind, StoredAsset>> = {};
  for (const kind of ASSET_KINDS) {
    const asset = value.assets?.[kind];
    if (asset && typeof asset.path === 'string' && typeof asset.hash === 'string') assets[kind] = asset;
  }
  // A field never written takes the default; one deliberately cleared stays clear.
  const optional = (key: 'tagline' | 'description' | 'supportEmail' | 'supportPhone' | 'address') =>
    value[key] === undefined ? defaults[key] : text(value[key]);
  return {
    productName: text(value.productName) ?? defaults.productName,
    shortName: text(value.shortName),
    tagline: optional('tagline'),
    description: optional('description'),
    companyName: text(value.companyName),
    supportEmail: optional('supportEmail'),
    supportPhone: optional('supportPhone'),
    websiteUrl: text(value.websiteUrl),
    address: optional('address'),
    brandColor: typeof value.brandColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.brandColor) ? value.brandColor.toLowerCase() : null,
    landingPage: LANDING_PAGES.includes(value.landingPage as LandingPage) ? (value.landingPage as LandingPage) : defaults.landingPage,
    assets,
    updatedAt: text(value.updatedAt),
    updatedBy: text(value.updatedBy),
  };
}

// --------------------------------------------------------------- profiles
/**
 * Saved brands. The platform keeps several complete brands - name, logos,
 * colour, contacts and landing page - and one of them is live. Switching is a
 * single change of `activeProfileId`, so nothing has to be set up again.
 */
export const BUILT_IN_PROFILES = ['steward', 'classic'] as const;
export type BuiltInProfile = (typeof BUILT_IN_PROFILES)[number];
export const MAX_PROFILES = 20;

export interface StoredProfile extends StoredBranding {
  id: string;
  /** Shown to Super Admins only. */
  label: string;
  /** Built-in profiles cannot be deleted and can be restored to their original. */
  builtIn: BuiltInProfile | null;
  /** Which built-in artwork the web app shows while nothing is uploaded. */
  artwork: BuiltInProfile | null;
  createdAt: string | null;
}

export interface StoredPlatformBranding {
  version: 2;
  activeProfileId: string;
  profiles: StoredProfile[];
}

export const BUILT_IN_DEFAULTS: Record<BuiltInProfile, { label: string; branding: StoredBranding }> = {
  steward: { label: 'MicroSteward', branding: DEFAULT_BRANDING },
  classic: { label: 'Microfinex Classic', branding: CLASSIC_BRANDING },
};

const PROFILE_ID = /^(steward|classic|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const isProfileId = (value: unknown): value is string => typeof value === 'string' && PROFILE_ID.test(value);

export function builtInProfile(kind: BuiltInProfile): StoredProfile {
  const { label, branding } = BUILT_IN_DEFAULTS[kind];
  return { ...branding, assets: {}, id: kind, label, builtIn: kind, artwork: kind, createdAt: null };
}

function normaliseProfile(raw: unknown): StoredProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<StoredProfile>;
  if (!isProfileId(value.id)) return null;
  const builtIn = BUILT_IN_PROFILES.includes(value.id as BuiltInProfile) ? (value.id as BuiltInProfile) : null;
  const defaults = builtIn ? BUILT_IN_DEFAULTS[builtIn].branding : DEFAULT_BRANDING;
  const fields = normaliseStored(value, defaults);
  return {
    ...fields,
    id: value.id,
    label: text(value.label) ?? (builtIn ? BUILT_IN_DEFAULTS[builtIn].label : fields.productName),
    builtIn,
    artwork: BUILT_IN_PROFILES.includes(value.artwork as BuiltInProfile) ? (value.artwork as BuiltInProfile) : builtIn,
    createdAt: text(value.createdAt),
  };
}

/**
 * The stored platform branding, made whole. Understands the first version
 * (a single brand), always contains both built-in profiles, and always has a
 * live profile that exists.
 */
export function normalisePlatform(raw: unknown): StoredPlatformBranding {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  let profiles: StoredProfile[] = [];
  let activeProfileId: unknown = 'steward';

  if (value && Array.isArray(value.profiles)) {
    const seen = new Set<string>();
    for (const entry of value.profiles) {
      const profile = normaliseProfile(entry);
      if (profile && !seen.has(profile.id)) {
        seen.add(profile.id);
        profiles.push(profile);
      }
    }
    activeProfileId = value.activeProfileId;
  } else if (value && typeof value.productName === 'string') {
    // Version 1: one brand, which becomes the MicroSteward profile.
    profiles = [{ ...builtInProfile('steward'), ...normaliseStored(value, DEFAULT_BRANDING) }];
  }

  for (const kind of BUILT_IN_PROFILES) {
    if (!profiles.some(profile => profile.id === kind)) profiles.push(builtInProfile(kind));
  }
  profiles.sort((a, b) => Number(Boolean(b.builtIn)) - Number(Boolean(a.builtIn)) || BUILT_IN_PROFILES.indexOf(a.builtIn as BuiltInProfile) - BUILT_IN_PROFILES.indexOf(b.builtIn as BuiltInProfile));

  return {
    version: 2,
    activeProfileId: profiles.some(profile => profile.id === activeProfileId) ? (activeProfileId as string) : 'steward',
    profiles,
  };
}

export const findProfile = (platform: StoredPlatformBranding, id: string) => {
  const profile = platform.profiles.find(entry => entry.id === id);
  if (!profile) throw new BrandingError('That brand profile no longer exists.', 'PROFILE_NOT_FOUND', 404);
  return profile;
};

/** normalisePlatform guarantees the live profile exists; the fallback is only for hand-built values. */
export const activeProfile = (platform: StoredPlatformBranding): StoredProfile =>
  platform.profiles.find(profile => profile.id === platform.activeProfileId) ?? platform.profiles[0] ?? builtInProfile('steward');

const replaceProfile = (platform: StoredPlatformBranding, profile: StoredProfile): StoredPlatformBranding => ({
  ...platform,
  profiles: platform.profiles.map(entry => (entry.id === profile.id ? profile : entry)),
});

/** Storage paths no profile uses any more, safe to delete. */
export function orphanedPaths(before: StoredPlatformBranding, after: StoredPlatformBranding): string[] {
  const used = new Set(after.profiles.flatMap(profile => Object.values(profile.assets).map(asset => asset!.path)));
  const previous = new Set(before.profiles.flatMap(profile => Object.values(profile.assets).map(asset => asset!.path)));
  return [...previous].filter(path => !used.has(path));
}

export function applyProfileUpdate(platform: StoredPlatformBranding, id: string, update: BrandingUpdate, now: string, userId: string) {
  const current = findProfile(platform, id);
  const { label, ...fields } = update;
  const next: StoredProfile = { ...current, ...fields, label: label ?? current.label, updatedAt: now, updatedBy: userId };
  return { platform: replaceProfile(platform, next), before: current, after: next };
}

export function activate(platform: StoredPlatformBranding, id: string): StoredPlatformBranding {
  findProfile(platform, id);
  return { ...platform, activeProfileId: id };
}

/** A copy of a profile to shape into another brand. Logos are shared until replaced. */
export function duplicate(platform: StoredPlatformBranding, id: string, newId: string, now: string, userId: string, label?: string | null) {
  if (platform.profiles.length >= MAX_PROFILES) {
    throw new BrandingError(`You can keep up to ${MAX_PROFILES} brand profiles. Delete one you no longer need first.`, 'TOO_MANY_PROFILES', 409);
  }
  const source = findProfile(platform, id);
  const copy: StoredProfile = {
    ...source,
    assets: { ...source.assets },
    id: newId,
    label: (label ?? '').trim().slice(0, 60) || `${source.label} (copy)`,
    builtIn: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: userId,
  };
  return { platform: { ...platform, profiles: [...platform.profiles, copy] }, profile: copy };
}

export function removeProfile(platform: StoredPlatformBranding, id: string): StoredPlatformBranding {
  const profile = findProfile(platform, id);
  if (profile.builtIn) throw new BrandingError('Built-in profiles cannot be deleted. Restore the original instead.', 'BUILT_IN_PROFILE', 409);
  if (platform.activeProfileId === id) throw new BrandingError('This brand is live. Switch to another brand before deleting it.', 'PROFILE_ACTIVE', 409);
  return { ...platform, profiles: platform.profiles.filter(entry => entry.id !== id) };
}

/** A built-in profile back to its original words, colour and landing page. Uploaded logos stay. */
export function restoreBuiltIn(platform: StoredPlatformBranding, id: string, now: string, userId: string) {
  const current = findProfile(platform, id);
  if (!current.builtIn) throw new BrandingError('Only built-in profiles have an original to restore.', 'NOT_BUILT_IN', 409);
  const original = builtInProfile(current.builtIn);
  const next: StoredProfile = { ...original, assets: current.assets, createdAt: current.createdAt, updatedAt: now, updatedBy: userId };
  return { platform: replaceProfile(platform, next), before: current, after: next };
}

export function setAsset(platform: StoredPlatformBranding, id: string, kind: AssetKind, asset: StoredAsset | null, now: string, userId: string) {
  const current = findProfile(platform, id);
  const assets = { ...current.assets };
  if (asset) assets[kind] = asset;
  else delete assets[kind];
  const next: StoredProfile = { ...current, assets, updatedAt: now, updatedBy: userId };
  return { platform: replaceProfile(platform, next), before: current, after: next };
}

// ---------------------------------------------------------------- colour
export const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;
export type Shade = (typeof SHADES)[number];

/** Tailwind's emerald and teal: the default look, reproduced exactly. */
const DEFAULT_PALETTE: Record<Shade, string> = {
  '50': '#ecfdf5',
  '100': '#d1fae5',
  '200': '#a7f3d0',
  '300': '#6ee7b7',
  '400': '#34d399',
  '500': '#10b981',
  '600': '#059669',
  '700': '#047857',
  '800': '#065f46',
  '900': '#064e3b',
  '950': '#022c22',
};
const DEFAULT_SECONDARY = '#0f766e';

const LIGHTNESS: Record<Shade, number> = {
  '50': 96,
  '100': 91,
  '200': 82,
  '300': 70,
  '400': 57,
  '500': 46,
  '600': 37,
  '700': 30,
  '800': 24,
  '900': 19,
  '950': 11,
};

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const channel = (n: number) =>
    Math.round(f(n) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export const hexToRgbChannels = (hex: string) =>
  `${parseInt(hex.slice(1, 3), 16)} ${parseInt(hex.slice(3, 5), 16)} ${parseInt(hex.slice(5, 7), 16)}`;

/**
 * Eleven shades from one colour, light to dark, keeping its hue. The app uses
 * the dark end for buttons and the sidebar, so any colour a brand picks still
 * carries white text.
 */
export function buildPalette(brandColor: string | null): { shades: Record<Shade, string>; secondary: string } {
  if (!brandColor) return { shades: { ...DEFAULT_PALETTE }, secondary: DEFAULT_SECONDARY };
  const [h, s] = hexToHsl(brandColor);
  // Greys stay grey; everything else keeps enough colour to read as the brand.
  const saturation = s < 8 ? s : Math.max(45, Math.min(s, 92));
  const shades = {} as Record<Shade, string>;
  for (const shade of SHADES) {
    const light = LIGHTNESS[shade];
    // Very light tints look washed out at full saturation.
    const tintSaturation = light > 85 ? Math.min(saturation, 80) : saturation;
    shades[shade] = hslToHex(h, tintSaturation, light);
  }
  return { shades, secondary: shades['700'] };
}

// ---------------------------------------------------------------- images
/** The real type of an uploaded image, from its bytes - never from what the browser claims. */
export function sniffImageType(buffer: Buffer): ImageType | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0) return 'image/x-icon';
  const head = buffer.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/**
 * Whether an SVG is safe to serve. An SVG is a document: opened directly it
 * can run script. Anything that could run code, load something from elsewhere
 * or expand entities is refused rather than cleaned, so what is served is
 * exactly what was checked.
 */
export function unsafeSvgReason(svg: string): string | null {
  const checks: Array<[RegExp, string]> = [
    [/<!DOCTYPE|<!ENTITY/i, 'document type or entity declarations'],
    [/<script[\s>]/i, 'a script'],
    [/<foreignObject[\s>]/i, 'embedded HTML (foreignObject)'],
    [/<(iframe|embed|object|audio|video)[\s>]/i, 'embedded content'],
    [/\son[a-z]+\s*=/i, 'event handlers (on... attributes)'],
    [/javascript:|vbscript:|data:text\/html/i, 'script links'],
    [/(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(?:png|jpeg|gif|webp);base64,)/i, 'links to other files'],
    [/@import|url\(\s*["']?\s*(?!#|data:image\/)/i, 'styles loaded from elsewhere'],
    [/<set[\s>]|<animate[^>]+attributeName\s*=\s*["'](?:href|xlink:href)/i, 'animated links'],
  ];
  for (const [pattern, reason] of checks) if (pattern.test(svg)) return reason;
  return null;
}

/** Check an upload for a slot, returning its real type. */
export function validateAsset(kind: AssetKind, buffer: Buffer): ImageType {
  const rules = ASSET_RULES[kind];
  if (!buffer.length) throw new BrandingError('The file is empty.', 'EMPTY_FILE');
  if (buffer.length > rules.maxBytes) {
    const limit = rules.maxBytes >= 1024 * 1024 ? `${rules.maxBytes / (1024 * 1024)}MB` : `${Math.round(rules.maxBytes / 1024)}KB`;
    throw new BrandingError(`The ${rules.label.toLowerCase()} must be ${limit} or smaller.`, 'FILE_TOO_LARGE');
  }
  const type = sniffImageType(buffer);
  if (!type || !rules.types.includes(type)) {
    const allowed = rules.types.map(t => EXTENSIONS[t].toUpperCase()).join(', ');
    throw new BrandingError(`The ${rules.label.toLowerCase()} must be ${allowed}.`, 'UNSUPPORTED_TYPE');
  }
  if (type === 'image/svg+xml') {
    const reason = unsafeSvgReason(buffer.toString('utf8'));
    if (reason) throw new BrandingError(`This SVG contains ${reason}, which is not allowed in a logo. Export it again as a plain SVG.`, 'UNSAFE_SVG');
  }
  return type;
}

// ------------------------------------------------------------- presenting
export const ASSET_ROUTE = '/api/v1/public/branding/assets';

/** What every visitor may know: no storage paths, no who-changed-what. */
export function presentBranding(stored: StoredBranding & { artwork?: BuiltInProfile | null }) {
  const { shades, secondary } = buildPalette(stored.brandColor);
  const channels = Object.fromEntries(SHADES.map(shade => [shade, hexToRgbChannels(shades[shade])])) as Record<Shade, string>;
  return {
    productName: stored.productName,
    shortName: stored.shortName ?? stored.productName,
    tagline: stored.tagline,
    description: stored.description,
    companyName: stored.companyName ?? stored.productName,
    supportEmail: stored.supportEmail,
    supportPhone: stored.supportPhone,
    websiteUrl: stored.websiteUrl,
    address: stored.address,
    brandColor: stored.brandColor,
    /** Which built-in logos the web app shows where nothing is uploaded. */
    artwork: stored.artwork === undefined ? 'steward' : stored.artwork,
    colors: {
      isDefault: !stored.brandColor,
      palette: shades,
      channels,
      primary: hexToRgbChannels(shades['900']),
      secondary: hexToRgbChannels(secondary),
    },
    landingPage: stored.landingPage,
    assets: Object.fromEntries(
      ASSET_KINDS.map(kind => {
        const asset = stored.assets[kind];
        return [kind, asset ? { custom: true, url: `${ASSET_ROUTE}/${kind}?v=${asset.hash.slice(0, 12)}` } : { custom: false, url: null }];
      })
    ) as Record<AssetKind, { custom: boolean; url: string | null }>,
    updatedAt: stored.updatedAt,
  };
}

export type PublicBranding = ReturnType<typeof presentBranding>;

/** Fields that changed, for the audit log. */
export function changedFields<T extends StoredBranding>(before: T, after: T): Array<keyof StoredBranding | 'label'> {
  const keys: Array<keyof StoredBranding> = ['productName', 'shortName', 'tagline', 'description', 'companyName', 'supportEmail', 'supportPhone', 'websiteUrl', 'address', 'brandColor', 'landingPage'];
  const changed: Array<keyof StoredBranding | 'label'> = keys.filter(key => before[key] !== after[key]);
  const label = (profile: T) => (profile as Partial<StoredProfile>).label;
  if (label(before) !== label(after)) changed.unshift('label');
  return changed;
}
