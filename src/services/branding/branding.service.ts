/**
 * White-label branding: saved brand profiles, stored as one platform setting
 * and cached in memory.
 *
 * Every page load asks for the live brand, so it is read from the database at
 * most every 30 seconds per server; a change made here clears the cache at
 * once, and other servers catch up within the same window.
 */

import crypto from 'crypto';
import { prisma } from '../../config/database';
import { storageService } from '../storage.service';
import { createAuditLog } from '../audit.service';
import { setBrandName } from './branding.cache';
import {
  ASSET_RULES,
  BRANDING_SETTING_KEY,
  BrandingError,
  EXTENSIONS,
  MAX_PROFILES,
  activate,
  activeProfile,
  applyProfileUpdate,
  brandingUpdateSchema,
  changedFields,
  duplicate,
  findProfile,
  normalisePlatform,
  orphanedPaths,
  presentBranding,
  removeProfile,
  restoreBuiltIn,
  setAsset,
  validateAsset,
  type AssetKind,
  type PublicBranding,
  type StoredPlatformBranding,
  type StoredProfile,
} from './branding.logic';

const CACHE_MS = 30_000;
const MAX_CACHED_ASSET_BYTES = 2 * 1024 * 1024;

class BrandingService {
  private cached: { value: StoredPlatformBranding; at: number } | null = null;
  private loading: Promise<StoredPlatformBranding> | null = null;
  private assetCache = new Map<string, { buffer: Buffer; mimeType: string }>();

  /** Load the branding early so the first emails and pages already use it. */
  async warm(): Promise<void> {
    await this.getPlatform().catch(error => console.warn('Branding could not be loaded; using defaults.', (error as Error).message));
  }

  async getPlatform(): Promise<StoredPlatformBranding> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    // One database read however many requests arrive at once.
    this.loading ??= prisma.systemSettings
      .findUnique({ where: { settingKey: BRANDING_SETTING_KEY } })
      .then(row => {
        const value = normalisePlatform(row?.settingValue);
        this.remember(value);
        return value;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /** The brand visitors see now. */
  async getPublic(): Promise<PublicBranding> {
    return presentBranding(activeProfile(await this.getPlatform()));
  }

  private remember(value: StoredPlatformBranding) {
    this.cached = { value, at: Date.now() };
    setBrandName(activeProfile(value).productName);
  }

  private async save(value: StoredPlatformBranding, userId: string, previous?: StoredPlatformBranding) {
    await prisma.systemSettings.upsert({
      where: { settingKey: BRANDING_SETTING_KEY },
      create: { settingKey: BRANDING_SETTING_KEY, settingValue: value as any, description: 'White-label brand profiles and the live brand', updatedBy: userId },
      update: { settingValue: value as any, updatedBy: userId },
    });
    this.remember(value);
    // Logos no profile uses any more.
    if (previous) {
      for (const path of orphanedPaths(previous, value)) {
        this.assetCache.delete(path);
        await storageService.delete(path);
      }
    }
    return value;
  }

  private audit(action: 'CREATE' | 'UPDATE' | 'DELETE', resourceId: string, userId: string, previousValue?: unknown, newValue?: unknown) {
    return createAuditLog({ action, resource: 'platform_branding', resourceId, userId, previousValue, newValue }).catch(() => undefined);
  }

  private parse(input: unknown) {
    const parsed = brandingUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new BrandingError(parsed.error.errors[0]?.message ?? 'Some branding details are not valid.', 'VALIDATION_ERROR');
    }
    return parsed.data;
  }

  /** A profile's words, colour and landing page. Logos are changed one at a time, below. */
  async updateProfile(id: string, input: unknown, userId: string): Promise<StoredProfile> {
    const update = this.parse(input);
    const platform = await this.getPlatform();
    const { platform: next, before, after } = applyProfileUpdate(platform, id, update, new Date().toISOString(), userId);
    await this.save(next, userId);
    const changed = changedFields(before, after);
    if (changed.length) {
      await this.audit(
        'UPDATE',
        `${BRANDING_SETTING_KEY}:${id}`,
        userId,
        Object.fromEntries(changed.map(key => [key, (before as any)[key]])),
        Object.fromEntries(changed.map(key => [key, (after as any)[key]]))
      );
    }
    return after;
  }

  /** Make a saved brand the live one. */
  async activateProfile(id: string, userId: string): Promise<void> {
    const platform = await this.getPlatform();
    if (platform.activeProfileId === id) return;
    const previousId = platform.activeProfileId;
    await this.save(activate(platform, id), userId);
    await this.audit('UPDATE', `${BRANDING_SETTING_KEY}:active`, userId, { activeProfileId: previousId }, { activeProfileId: id });
  }

  async duplicateProfile(id: string, label: string | null | undefined, userId: string): Promise<StoredProfile> {
    const platform = await this.getPlatform();
    const { platform: next, profile } = duplicate(platform, id, crypto.randomUUID(), new Date().toISOString(), userId, label);
    await this.save(next, userId);
    await this.audit('CREATE', `${BRANDING_SETTING_KEY}:${profile.id}`, userId, undefined, { copiedFrom: id, label: profile.label });
    return profile;
  }

  async deleteProfile(id: string, userId: string): Promise<void> {
    const platform = await this.getPlatform();
    const profile = findProfile(platform, id);
    await this.save(removeProfile(platform, id), userId, platform);
    await this.audit('DELETE', `${BRANDING_SETTING_KEY}:${id}`, userId, { label: profile.label, productName: profile.productName });
  }

  async restoreProfile(id: string, userId: string): Promise<StoredProfile> {
    const platform = await this.getPlatform();
    const { platform: next, before, after } = restoreBuiltIn(platform, id, new Date().toISOString(), userId);
    await this.save(next, userId);
    await this.audit('UPDATE', `${BRANDING_SETTING_KEY}:${id}`, userId, { restored: false, productName: before.productName }, { restored: true, productName: after.productName });
    return after;
  }

  async uploadAsset(id: string, kind: AssetKind, buffer: Buffer, userId: string): Promise<void> {
    const mimeType = validateAsset(kind, buffer);
    const platform = await this.getPlatform();
    const current = findProfile(platform, id);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const path = `platform/branding/${kind}/${Date.now()}-${hash.slice(0, 16)}.${EXTENSIONS[mimeType]}`;
    await storageService.putObject(path, buffer, mimeType);
    this.assetCache.set(path, { buffer, mimeType });

    const now = new Date().toISOString();
    const { platform: next } = setAsset(platform, id, kind, { path, mimeType, size: buffer.length, hash, uploadedAt: now }, now, userId);
    await this.save(next, userId, platform);
    await this.audit('UPDATE', `${BRANDING_SETTING_KEY}:${id}:${kind}`, userId, undefined, {
      asset: kind,
      mimeType,
      size: buffer.length,
      replaced: Boolean(current.assets[kind]),
    });
  }

  async removeAsset(id: string, kind: AssetKind, userId: string): Promise<void> {
    const platform = await this.getPlatform();
    const previous = findProfile(platform, id).assets[kind];
    if (!previous) return;
    const now = new Date().toISOString();
    const { platform: next } = setAsset(platform, id, kind, null, now, userId);
    await this.save(next, userId, platform);
    await this.audit('DELETE', `${BRANDING_SETTING_KEY}:${id}:${kind}`, userId, { asset: kind, mimeType: previous.mimeType, size: previous.size });
  }

  /**
   * An uploaded logo, for serving. With a version (the start of its hash) it
   * is found in whichever profile holds it, so the branding screen can show a
   * saved brand that is not live; without one, the live brand's.
   */
  async readAsset(kind: AssetKind, version?: string): Promise<{ buffer: Buffer; mimeType: string; hash: string } | null> {
    const platform = await this.getPlatform();
    const live = activeProfile(platform);
    const asset =
      version && version.length >= 8
        ? [live, ...platform.profiles].map(profile => profile.assets[kind]).find(entry => entry?.hash.startsWith(version))
        : live.assets[kind];
    if (!asset) return null;
    let entry = this.assetCache.get(asset.path);
    if (!entry) {
      const buffer = await storageService.download(asset.path);
      entry = { buffer, mimeType: asset.mimeType };
      if (buffer.length <= MAX_CACHED_ASSET_BYTES) this.assetCache.set(asset.path, entry);
    }
    return { ...entry, hash: asset.hash };
  }

  /** Everything the Super Admin screen needs. */
  async adminView() {
    const platform = await this.getPlatform();
    return {
      activeProfileId: platform.activeProfileId,
      maxProfiles: MAX_PROFILES,
      assetRules: ASSET_RULES,
      profiles: platform.profiles.map(profile => ({
        id: profile.id,
        label: profile.label,
        builtIn: profile.builtIn,
        active: profile.id === platform.activeProfileId,
        settings: {
          label: profile.label,
          productName: profile.productName,
          shortName: profile.shortName,
          tagline: profile.tagline,
          description: profile.description,
          companyName: profile.companyName,
          supportEmail: profile.supportEmail,
          supportPhone: profile.supportPhone,
          websiteUrl: profile.websiteUrl,
          address: profile.address,
          brandColor: profile.brandColor,
          landingPage: profile.landingPage,
        },
        assets: Object.fromEntries(
          (Object.keys(ASSET_RULES) as AssetKind[]).map(kind => {
            const asset = profile.assets[kind];
            return [kind, asset ? { mimeType: asset.mimeType, size: asset.size, uploadedAt: asset.uploadedAt } : null];
          })
        ),
        public: presentBranding(profile),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      })),
    };
  }
}

export const brandingService = new BrandingService();
