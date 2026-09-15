import express from 'express';
import request from 'supertest';

/**
 * Branding endpoints with the service mocked: who may change branding, and
 * that an uploaded logo is served so it can never run as a page.
 */

let role = 'SUPER_ADMIN';

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
  adminView: jest.fn(async () => ({ settings: { productName: 'MicroSteward' } })),
  update: jest.fn(async () => ({})),
  uploadAsset: jest.fn(async () => ({})),
  removeAsset: jest.fn(async () => ({})),
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
  it('reads the branding without signing in', async () => {
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

describe('changing branding', () => {
  it('is only for the Super Admin', async () => {
    role = 'ORG_ADMIN';
    expect((await request(app).put('/branding').send({ productName: 'Mine' })).status).toBe(403);
    expect((await request(app).post('/branding/assets/logo').attach('file', svg, 'logo.svg')).status).toBe(403);
    expect(service.update).not.toHaveBeenCalled();
    expect(service.uploadAsset).not.toHaveBeenCalled();
  });

  it('saves and returns the new state', async () => {
    const response = await request(app).put('/branding').send({ productName: 'Acme Lending', landingPage: 'classic' });
    expect(response.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith({ productName: 'Acme Lending', landingPage: 'classic' }, '22222222-2222-4222-8222-222222222222');
  });

  it('shows a validation problem as a readable message', async () => {
    service.update.mockRejectedValueOnce(new BrandingError('The product name needs at least 2 characters.', 'VALIDATION_ERROR'));
    const response = await request(app).put('/branding').send({ productName: 'A' });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/at least 2/);
  });

  it('uploads into the named slot', async () => {
    const response = await request(app).post('/branding/assets/mark').attach('file', svg, 'mark.svg');
    expect(response.status).toBe(201);
    expect((service.uploadAsset.mock.calls[0] as any[])[0]).toBe('mark');
  });

  it('asks for a file when none is sent', async () => {
    expect((await request(app).post('/branding/assets/logo')).status).toBe(400);
  });

  it('restores the built-in logo', async () => {
    expect((await request(app).delete('/branding/assets/favicon')).status).toBe(200);
    expect((service.removeAsset.mock.calls[0] as any[])[0]).toBe('favicon');
  });
});
