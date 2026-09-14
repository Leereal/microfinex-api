import express from 'express';
import request from 'supertest';

/**
 * The discussion-thread endpoints, with the service mocked.
 *
 * The routes used to be registered as /:id while the handlers read
 * req.params.noteId, so editing, pinning and deleting a message always failed
 * with "Note ID is required". These hold the routes and handlers together.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const NOTE = '44444444-4444-4444-8444-444444444444';

let permissions: string[] = [];

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: USER, organizationId: ORG };
    next();
  },
}));

jest.mock('../src/middleware/permissions', () => ({
  loadPermissions: (req: any, _res: any, next: any) => {
    req.user.id = req.user.userId;
    req.user.permissions = permissions;
    next();
  },
  requirePermission: (code: string) => (_req: any, res: any, next: any) =>
    permissions.includes(code)
      ? next()
      : res.status(403).json({ success: false, error: 'FORBIDDEN', requiredPermission: code }),
}));

const service = {
  counts: jest.fn(async () => ({ [CLIENT]: { total: 3, unread: 1 } })),
  list: jest.fn(async () => ({ entity: {}, lastReadAt: null, notes: [] })),
  create: jest.fn(async () => ({ id: NOTE })),
  update: jest.fn(async () => ({ id: NOTE })),
  togglePin: jest.fn(async () => ({ id: NOTE, isPinned: true })),
  remove: jest.fn(async () => undefined),
  markRead: jest.fn(async () => undefined),
  resolveEntity: jest.fn(async () => ({})),
};

jest.mock('../src/services/notes/note-thread.service', () => ({
  noteThreadService: new Proxy({}, { get: (_t, key: string) => (service as any)[key] }),
}));

import notesRoutes from '../src/routes/notes.routes';
import { NoteThreadError } from '../src/services/notes/note-thread.logic';

const app = express();
app.use(express.json());
app.use('/notes', notesRoutes);

beforeEach(() => {
  jest.clearAllMocks();
  permissions = ['notes:view', 'notes:create', 'notes:update', 'notes:delete'];
});

describe('changing a message reaches the handler with its id', () => {
  it('edits', async () => {
    const response = await request(app).put(`/notes/${NOTE}`).send({ content: 'Updated' });
    expect(response.status).toBe(200);
    expect((service.update.mock.calls[0] as any[])[1]).toBe(NOTE);
  });

  it('pins', async () => {
    const response = await request(app).patch(`/notes/${NOTE}/toggle-pin`);
    expect(response.status).toBe(200);
    expect((service.togglePin.mock.calls[0] as any[])[1]).toBe(NOTE);
  });

  it('deletes', async () => {
    const response = await request(app).delete(`/notes/${NOTE}`);
    expect(response.status).toBe(200);
    expect((service.remove.mock.calls[0] as any[])[1]).toBe(NOTE);
  });
});

describe('what a thread can belong to', () => {
  it('refuses anything but a client or a loan', async () => {
    const response = await request(app).get(`/notes/PAYMENT/${CLIENT}`);
    expect(response.status).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('refuses an id that is not a record id', async () => {
    const response = await request(app).get('/notes/CLIENT/not-a-uuid');
    expect(response.status).toBe(400);
  });
});

describe('posting', () => {
  it('passes the files and fields through, as multipart', async () => {
    const response = await request(app)
      .post(`/notes/LOAN/${CLIENT}`)
      .field('content', 'Payslip attached')
      .field('isPrivate', 'true')
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'payslip.pdf', contentType: 'application/pdf' });
    expect(response.status).toBe(201);
    const [ctx, entityType, entityId, body, files] = service.create.mock.calls[0] as any[];
    expect(ctx).toMatchObject({ organizationId: ORG, userId: USER, canViewPrivate: false });
    expect(entityType).toBe('LOAN');
    expect(entityId).toBe(CLIENT);
    expect(body).toEqual({ content: 'Payslip attached', isPrivate: true });
    expect(files[0].originalname).toBe('payslip.pdf');
  });

  it('turns a refusal into its status and message', async () => {
    service.create.mockRejectedValueOnce(new NoteThreadError('Loan not found.', 'NOT_FOUND', 404) as never);
    const response = await request(app).post(`/notes/LOAN/${CLIENT}`).send({ content: 'x' });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'NOT_FOUND', message: 'Loan not found.' });
  });

  it('needs notes:create', async () => {
    permissions = ['notes:view'];
    const response = await request(app).post(`/notes/LOAN/${CLIENT}`).send({ content: 'x' });
    expect(response.status).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
  });
});

describe('counts for a list screen', () => {
  it('reads a page of records in one request', async () => {
    const response = await request(app)
      .post('/notes/counts')
      .send({ entityType: 'CLIENT', entityIds: [CLIENT] });
    expect(response.status).toBe(200);
    expect(response.body.data.counts[CLIENT]).toEqual({ total: 3, unread: 1 });
  });

  it('is not mistaken for a thread', async () => {
    await request(app).post('/notes/counts').send({ entityType: 'CLIENT', entityIds: [] });
    expect(service.create).not.toHaveBeenCalled();
  });

  it('refuses an oversized page', async () => {
    const response = await request(app)
      .post('/notes/counts')
      .send({ entityType: 'CLIENT', entityIds: Array.from({ length: 501 }, () => CLIENT) });
    expect(response.status).toBe(400);
  });
});

it('tells the service who may see private messages and delete others’', async () => {
  permissions = ['notes:view', 'notes:view_private', 'notes:delete_any'];
  await request(app).get(`/notes/CLIENT/${CLIENT}`);
  expect((service.list.mock.calls[0] as any[])[0]).toMatchObject({ canViewPrivate: true, canDeleteAny: true });
});
