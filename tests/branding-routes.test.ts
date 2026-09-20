import express from 'express';
import request from 'supertest';

/**
 * Branding endpoints with the service mocked: who may change branding, the
 * profile routes reach the right profile, and an uploaded logo is served so it
 * can never run as a page.
 */

let role = 'SUPER_ADMIN';
const USER = '22222222-2222-4222-8222-222222222222';
const COPY = '33333333-3333-4333-8333-333333333333';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: '22222222-2222-4222-8222-222222222222', role };
    next();
  },
  authorize:
    (...roles: string[]) =>
    (req: any, res: any, next: any) =>
      roles.includes(req.user.role) ? next() : res.status(403).json({ success: false, error: 'FORBIDDEN' }),
}));

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const service = {
  getPublic: jest.fn(async () => ({ productName: 'MicroSteward', landingPage: 'steward' })),
  readAsset: jest.fn(async (): Promise<any> => ({ buffer: svg, mimeType: 'image/svg+xml', hash: 'abcdef0123456789' })),
  adminView: jest.fn(async () => ({ activeProfileId: 'steward', profiles: [] })),
  updateProfile: jest.fn(async () => ({})),
  activateProfile: jest.fn(async () => undefined),
  duplicateProfile: jest.fn(async () => ({ id: COPY })),
  restoreProfile: jest.fn(async () => ({})),
  deleteProfile: jest.fn(async () => undefined),
  uploadAsset: jest.fn(async () => undefined),
  removeAsset: jest.fn(async () => undefined),
};

jest.mock('../src/services/branding/branding.service', () => ({
  brandingService: new Proxy({}, { get: (_t, key: string) => (service as any)[key] }),
}));

import brandingRoutes, { brandingPublicRoutes } from '../src/routes/branding.routes';
import { BrandingError } from '../src/services/branding/branding.logic';

const app = express();
app.use(express.json());
app.use('/public/branding', brandingPublicRoutes);
app.use('/branding', brandingRoutes);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ message: error.message }));

beforeEach(() => {
  jest.clearAllMocks();
  role = 'SUPER_ADMIN';
});

describe('anyone', () => {
  it('reads the live brand without signing in', async () => {
    const response = await request(app).get('/public/branding');
    expect(response.status).toBe(200);
    expect(response.body.data.productName).toBe('MicroSteward');
  });

  it('gets a logo that cannot run script, cached by its version', async () => {
    const response = await request(app).get('/public/branding/assets/logo?v=abcdef012345');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/svg+xml');
    expect(response.headers['content-security-policy']).toContain('sandbox');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.headers['cache-control']).toContain('immutable');
    expect(service.readAsset).toHaveBeenCalledWith('logo', 'abcdef012345');
  });

  it('ignores a version that is not a hash', async () => {
    await request(app).get('/public/branding/assets/logo?v=../../etc');
    expect(service.readAsset).toHaveBeenCalledWith('logo', undefined);
  });

  it('is told a slot uses the built-in logo', async () => {
    service.readAsset.mockResolvedValueOnce(null);
    expect((await request(app).get('/public/branding/assets/mark')).status).toBe(404);
  });

  it('cannot ask for an unknown slot', async () => {
    expect((await request(app).get('/public/branding/assets/..%2Fsecret')).status).toBe(404);
    expect(service.readAsset).not.toHaveBeenCalled();
  });
});

describe('managing brands', () => {
  it('is only for the Super Admin', async () => {
    role = 'ORG_ADMIN';
    expect((await request(app).get('/branding')).status).toBe(403);
    expect((await request(app).post('/branding/profiles/classic/activate')).status).toBe(403);
    expect((await request(app).put('/branding/profiles/steward').send({ productName: 'Mine' })).status).toBe(403);
    expect((await request(app).post('/branding/profiles/steward/assets/logo').attach('file', svg, 'logo.svg')).status).toBe(403);
    expect(service.activateProfile).not.toHaveBeenCalled();
    expect(service.updateProfile).not.toHaveBeenCalled();
    expect(service.uploadAsset).not.toHaveBeenCalled();
  });

  it('switches the live brand', async () => {
    const response = await request(app).post('/branding/profiles/classic/activate');
    expect(response.status).toBe(200);
    expect(service.activateProfile).toHaveBeenCalledWith('classic', USER);
    expect(response.body.data.activeProfileId).toBeDefined();
  });

  it('saves the profile named in the address', async () => {
    const response = await request(app).put(`/branding/profiles/${COPY}`).send({ productName: 'Acme Lending', landingPage: 'classic' });
    expect(response.status).toBe(200);
    expect(service.updateProfile).toHaveBeenCalledWith(COPY, { productName: 'Acme Lending', landingPage: 'classic' }, USER);
  });

  it('refuses a profile id that could not exist', async () => {
    expect((await request(app).put('/branding/profiles/..%2F..').send({ productName: 'X Co' })).status).toBe(404);
    expect((await request(app).post('/branding/profiles/drop-table/activate')).status).toBe(404);
    expect(service.updateProfile).not.toHaveBeenCalled();
  });

  it('copies, restores and deletes', async () => {
    const copied = await request(app).post('/branding/profiles/steward/duplicate').send({ label: 'Acme' });
    expect(copied.status).toBe(201);
    expect(copied.body.data.createdProfileId).toBe(COPY);
    expect(service.duplicateProfile).toHaveBeenCalledWith('steward', 'Acme', USER);

    expect((await request(app).post('/branding/profiles/classic/restore')).status).toBe(200);
    expect((await request(app).delete(`/branding/profiles/${COPY}`)).status).toBe(200);
    expect(service.deleteProfile).toHaveBeenCalledWith(COPY, USER);
  });

  it('shows why a brand cannot be deleted', async () => {
    service.deleteProfile.mockRejectedValueOnce(new BrandingError('This brand is live. Switch to another brand before deleting it.', 'PROFILE_ACTIVE', 409));
    const response = await request(app).delete(`/branding/profiles/${COPY}`);
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/live/);
  });

  it('shows a validation problem as a readable message', async () => {
    service.updateProfile.mockRejectedValueOnce(new BrandingError('The product name needs at least 2 characters.', 'VALIDATION_ERROR'));
    const response = await request(app).put('/branding/profiles/steward').send({ productName: 'A' });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/at least 2/);
  });

  it('uploads into the named profile and slot', async () => {
    const response = await request(app).post('/branding/profiles/classic/assets/mark').attach('file', svg, 'mark.svg');
    expect(response.status).toBe(201);
    expect((service.uploadAsset.mock.calls[0] as any[]).slice(0, 2)).toEqual(['classic', 'mark']);
  });

  it('asks for a file when none is sent', async () => {
    expect((await request(app).post('/branding/profiles/steward/assets/logo')).status).toBe(400);
  });

  it('restores the built-in logo', async () => {
    expect((await request(app).delete('/branding/profiles/steward/assets/favicon')).status).toBe(200);
    expect(service.removeAsset).toHaveBeenCalledWith('steward', 'favicon', USER);
  });
});
