/**
 * White-label branding: saved brand profiles, one of them live.
 *
 * Public:
 *   GET    /api/v1/public/branding                      the live brand
 *   GET    /api/v1/public/branding/assets/:kind         an uploaded logo
 * Super Admin:
 *   GET    /api/v1/branding                             every profile
 *   PUT    /api/v1/branding/profiles/:id                edit a profile
 *   POST   /api/v1/branding/profiles/:id/activate       make it live
 *   POST   /api/v1/branding/profiles/:id/duplicate      copy it
 *   POST   /api/v1/branding/profiles/:id/restore        a built-in profile back to its original
 *   DELETE /api/v1/branding/profiles/:id                delete a copy
 *   POST   /api/v1/branding/profiles/:id/assets/:kind   upload a logo
 *   DELETE /api/v1/branding/profiles/:id/assets/:kind   back to the built-in logo
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/auth';
import { handleAsync } from '../middleware/validation.middleware';
import { UserRole } from '../types';
import { brandingService } from '../services/branding/branding.service';
import { ASSET_KINDS, BrandingError, isProfileId, type AssetKind } from '../services/branding/branding.logic';

const now = () => new Date().toISOString();
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const fail = (res: Response, error: unknown) => {
  if (error instanceof BrandingError) {
    res.status(error.httpStatus).json({ success: false, message: error.message, error: error.code, timestamp: now() });
    return true;
  }
  return false;
};

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  handleAsync(async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (!fail(res, error)) throw error;
    }
  });

const assetKind = (req: Request): AssetKind => {
  const kind = req.params.kind as AssetKind;
  if (!ASSET_KINDS.includes(kind)) throw new BrandingError('Unknown logo slot.', 'UNKNOWN_ASSET', 404);
  return kind;
};

const profileId = (req: Request): string => {
  if (!isProfileId(req.params.id)) throw new BrandingError('That brand profile no longer exists.', 'PROFILE_NOT_FOUND', 404);
  return req.params.id;
};

// ------------------------------------------------------------------ public
export const brandingPublicRoutes = Router();

brandingPublicRoutes.get(
  '/',
  handle(async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ success: true, data: await brandingService.getPublic(), timestamp: now() });
  })
);

brandingPublicRoutes.get(
  '/assets/:kind',
  handle(async (req, res) => {
    const kind = assetKind(req);
    const version = typeof req.query.v === 'string' && /^[0-9a-f]{8,64}$/i.test(req.query.v) ? req.query.v.toLowerCase() : undefined;
    const asset = await brandingService.readAsset(kind, version);
    if (!asset) {
      res.status(404).json({ success: false, message: 'This slot uses the built-in logo.', error: 'NOT_CUSTOMISED', timestamp: now() });
      return;
    }
    const versioned = Boolean(version && asset.hash.startsWith(version));
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', String(asset.buffer.length));
    res.setHeader('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    res.setHeader('ETag', `"${asset.hash.slice(0, 32)}"`);
    // Logos are shown by the web app on another origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Nothing in a logo may run, even when the file is opened directly.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(asset.buffer);
  })
);

// ------------------------------------------------------------- super admin
const router = Router();
router.use(authenticate, authorize(UserRole.SUPER_ADMIN));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1 } });
const acceptFile = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, error => {
    if (!error) return next();
    const message =
      error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
        ? `The file must be ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB or smaller.`
        : 'The file could not be read.';
    res.status(400).json({ success: false, message, error: 'INVALID_FILE', timestamp: now() });
  });

const userId = (req: Request) => (req.user as { userId: string }).userId;

/** Every change answers with the whole screen's state, so the page never guesses. */
const respond = async (res: Response, message: string, status = 200) =>
  res.status(status).json({ success: true, message, data: await brandingService.adminView(), timestamp: now() });

router.get(
  '/',
  handle(async (_req, res) => {
    res.json({ success: true, data: await brandingService.adminView(), timestamp: now() });
  })
);

router.put(
  '/profiles/:id',
  handle(async (req, res) => {
    await brandingService.updateProfile(profileId(req), req.body ?? {}, userId(req));
    await respond(res, 'Brand saved');
  })
);

router.post(
  '/profiles/:id/activate',
  handle(async (req, res) => {
    await brandingService.activateProfile(profileId(req), userId(req));
    await respond(res, 'Brand switched');
  })
);

router.post(
  '/profiles/:id/duplicate',
  handle(async (req, res) => {
    const label = typeof req.body?.label === 'string' ? req.body.label : null;
    const profile = await brandingService.duplicateProfile(profileId(req), label, userId(req));
    res.status(201).json({ success: true, message: 'Brand copied', data: { ...(await brandingService.adminView()), createdProfileId: profile.id }, timestamp: now() });
  })
);

router.post(
  '/profiles/:id/restore',
  handle(async (req, res) => {
    await brandingService.restoreProfile(profileId(req), userId(req));
    await respond(res, 'Original restored');
  })
);

router.delete(
  '/profiles/:id',
  handle(async (req, res) => {
    await brandingService.deleteProfile(profileId(req), userId(req));
    await respond(res, 'Brand deleted');
  })
);

router.post(
  '/profiles/:id/assets/:kind',
  acceptFile,
  handle(async (req, res) => {
    const id = profileId(req);
    const kind = assetKind(req);
    if (!req.file) throw new BrandingError('Choose a file to upload.', 'NO_FILE');
    await brandingService.uploadAsset(id, kind, req.file.buffer, userId(req));
    await respond(res, 'Logo uploaded', 201);
  })
);

router.delete(
  '/profiles/:id/assets/:kind',
  handle(async (req, res) => {
    await brandingService.removeAsset(profileId(req), assetKind(req), userId(req));
    await respond(res, 'Restored the built-in logo');
  })
);

export default router;
