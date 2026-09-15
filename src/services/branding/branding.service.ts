/**
 * White-label branding: stored as one platform setting, cached in memory.
 *
 * Every page load asks for the branding, so it is read from the database at
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
  brandingUpdateSchema,
  changedFields,
  normaliseStored,
  presentBranding,
  validateAsset,
  type AssetKind,
  type PublicBranding,
  type StoredBranding,
} from './branding.logic';

const CACHE_MS = 30_000;
const MAX_CACHED_ASSET_BYTES = 2 * 1024 * 1024;

class BrandingService {
  private cached: { value: StoredBranding; at: number } | null = null;
  private loading: Promise<StoredBranding> | null = null;
  private assetCache = new Map<string, { buffer: Buffer; mimeType: string }>();

  /** Load the branding early so the first emails and pages already use it. */
  async warm(): Promise<void> {
    await this.getStored().catch(error => console.warn('Branding could not be loaded; using defaults.', (error as Error).message));
  }

  async getStored(): Promise<StoredBranding> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    // One database read however many requests arrive at once.
    this.loading ??= prisma.systemSettings
      .findUnique({ where: { settingKey: BRANDING_SETTING_KEY } })
      .then(row => {
        const value = normaliseStored(row?.settingValue);
        this.remember(value);
        return value;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  async getPublic(): Promise<PublicBranding> {
    return presentBranding(await this.getStored());
  }

  private remember(value: StoredBranding) {
    this.cached = { value, at: Date.now() };
    setBrandName(value.productName);
  }

  private async save(value: StoredBranding, userId: string) {
    const next: StoredBranding = { ...value, updatedAt: new Date().toISOString(), updatedBy: userId };
    await prisma.systemSettings.upsert({
      where: { settingKey: BRANDING_SETTING_KEY },
      create: { settingKey: BRANDING_SETTING_KEY, settingValue: next as any, description: 'White-label branding and landing page', updatedBy: userId },
      update: { settingValue: next as any, updatedBy: userId },
    });
    this.remember(next);
    return next;
  }

  /** The editable fields. Logos are changed one at a time, below. */
  async update(input: unknown, userId: string): Promise<StoredBranding> {
    const parsed = brandingUpdateSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.errors[0];
      throw new BrandingError(issue?.message ?? 'Some branding details are not valid.', 'VALIDATION_ERROR');
    }
    const before = await this.getStored();
    const after = await this.save({ ...before, ...parsed.data }, userId);
    const changed = changedFields(before, after);
    if (changed.length) {
      await createAuditLog({
        action: 'UPDATE',
        resource: 'platform_branding',
        resourceId: BRANDING_SETTING_KEY,
        userId,
        previousValue: Object.fromEntries(changed.map(key => [key, before[key]])),
        newValue: Object.fromEntries(changed.map(key => [key, after[key]])),
      }).catch(() => undefined);
    }
    return after;
  }

  async uploadAsset(kind: AssetKind, buffer: Buffer, userId: string): Promise<StoredBranding> {
    const mimeType = validateAsset(kind, buffer);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const path = `platform/branding/${kind}/${Date.now()}-${hash.slice(0, 16)}.${EXTENSIONS[mimeType]}`;
    await storageService.putObject(path, buffer, mimeType);

    const before = await this.getStored();
    const previous = before.assets[kind];
    const after = await this.save(
      { ...before, assets: { ...before.assets, [kind]: { path, mimeType, size: buffer.length, hash, uploadedAt: new Date().toISOString() } } },
      userId
    );
    this.assetCache.set(path, { buffer, mimeType });
    if (previous && previous.path !== path) {
      this.assetCache.delete(previous.path);
      await storageService.delete(previous.path);
    }
    await createAuditLog({
      action: 'UPDATE',
      resource: 'platform_branding',
      resourceId: `${BRANDING_SETTING_KEY}:${kind}`,
      userId,
      newValue: { asset: kind, mimeType, size: buffer.length, replaced: Boolean(previous) },
    }).catch(() => undefined);
    return after;
  }

  async removeAsset(kind: AssetKind, userId: string): Promise<StoredBranding> {
    const before = await this.getStored();
    const previous = before.assets[kind];
    if (!previous) return before;
    const assets = { ...before.assets };
    delete assets[kind];
    const after = await this.save({ ...before, assets }, userId);
    this.assetCache.delete(previous.path);
    await storageService.delete(previous.path);
    await createAuditLog({
      action: 'DELETE',
      resource: 'platform_branding',
      resourceId: `${BRANDING_SETTING_KEY}:${kind}`,
      userId,
      previousValue: { asset: kind, mimeType: previous.mimeType, size: previous.size },
    }).catch(() => undefined);
    return after;
  }

  /** An uploaded logo, for serving. Null when the slot uses the built-in default. */
  async readAsset(kind: AssetKind): Promise<{ buffer: Buffer; mimeType: string; hash: string } | null> {
    const asset = (await this.getStored()).assets[kind];
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
    const stored = await this.getStored();
    return {
      settings: {
        productName: stored.productName,
        shortName: stored.shortName,
        tagline: stored.tagline,
        description: stored.description,
        companyName: stored.companyName,
        supportEmail: stored.supportEmail,
        supportPhone: stored.supportPhone,
        websiteUrl: stored.websiteUrl,
        brandColor: stored.brandColor,
        landingPage: stored.landingPage,
      },
      assets: Object.fromEntries(
        (Object.keys(ASSET_RULES) as AssetKind[]).map(kind => {
          const asset = stored.assets[kind];
          return [kind, asset ? { mimeType: asset.mimeType, size: asset.size, uploadedAt: asset.uploadedAt } : null];
        })
      ),
      assetRules: ASSET_RULES,
      public: presentBranding(stored),
      updatedAt: stored.updatedAt,
    };
  }
}

export const brandingService = new BrandingService();
