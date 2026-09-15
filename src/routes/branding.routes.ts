/**
 * White-label branding.
 *
 * Public:      GET /api/v1/public/branding, GET /api/v1/public/branding/assets/:kind
 * Super Admin: GET/PUT /api/v1/branding, POST/DELETE /api/v1/branding/assets/:kind
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/auth';
import { handleAsync } from '../middleware/validation.middleware';
import { UserRole } from '../types';
import { brandingService } from '../services/branding/branding.service';
import { ASSET_KINDS, BrandingError, type AssetKind } from '../services/branding/branding.logic';

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
    const asset = await brandingService.readAsset(kind);
    if (!asset) {
      res.status(404).json({ success: false, message: 'This slot uses the built-in logo.', error: 'NOT_CUSTOMISED', timestamp: now() });
      return;
    }
    const versioned = typeof req.query.v === 'string' && asset.hash.startsWith(req.query.v);
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

router.get(
  '/',
  handle(async (_req, res) => {
    res.json({ success: true, data: await brandingService.adminView(), timestamp: now() });
  })
);

router.put(
  '/',
  handle(async (req, res) => {
    await brandingService.update(req.body ?? {}, userId(req));
    res.json({ success: true, message: 'Branding saved', data: await brandingService.adminView(), timestamp: now() });
  })
);

router.post(
  '/assets/:kind',
  acceptFile,
  handle(async (req, res) => {
    const kind = assetKind(req);
    if (!req.file) throw new BrandingError('Choose a file to upload.', 'NO_FILE');
    await brandingService.uploadAsset(kind, req.file.buffer, userId(req));
    res.status(201).json({ success: true, message: 'Logo uploaded', data: await brandingService.adminView(), timestamp: now() });
  })
);

router.delete(
  '/assets/:kind',
  handle(async (req, res) => {
    await brandingService.removeAsset(assetKind(req), userId(req));
    res.json({ success: true, message: 'Restored the built-in logo', data: await brandingService.adminView(), timestamp: now() });
  })
);

export default router;
