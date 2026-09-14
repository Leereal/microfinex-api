/**
 * The discussion-thread service, with the database and storage mocked.
 *
 * Covers what can go wrong without anyone noticing: files left in storage
 * when a message fails to save, a deleted message that is really erased, one
 * person rewriting another's words, and a thread attached to a record from
 * another organization.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const LOAN = '44444444-4444-4444-8444-444444444444';
const NOTE = '55555555-5555-4555-8555-555555555555';

const db: any = {
  client: { findFirst: jest.fn() },
  loan: { findFirst: jest.fn() },
  user: { findMany: jest.fn(async () => []) },
  note: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(async () => []),
    update: jest.fn(),
  },
  noteAttachment: { deleteMany: jest.fn(() => 'deleteAttachments') },
  noteReadMarker: { upsert: jest.fn(async () => ({})), findUnique: jest.fn(async () => null) },
  $transaction: jest.fn(async () => []),
  $queryRaw: jest.fn(async () => []),
};

jest.mock('../src/config/database', () => ({
  get prisma() {
    return db;
  },
}));

const storage = {
  upload: jest.fn(),
  deleteMany: jest.fn(async () => ({})),
  getSignedUrl: jest.fn(async () => 'https://signed'),
};
jest.mock('../src/services/storage.service', () => ({
  storageService: new Proxy({}, { get: (_t, key: string) => (storage as any)[key] }),
}));

const createAuditLog = jest.fn(async () => ({}));
jest.mock('../src/services/audit.service', () => ({
  createAuditLog: (...args: unknown[]) => (createAuditLog as any)(...args),
}));

const notify = jest.fn(async () => ({}));
jest.mock('../src/services/in-app-notification.service', () => ({
  inAppNotificationService: { notify: (...args: unknown[]) => (notify as any)(...args) },
  NOTIFICATION_TYPES: { NOTE_ADDED: 'NOTE_ADDED' },
}));

import { NoteThreadService } from '../src/services/notes/note-thread.service';
import { NoteThreadError } from '../src/services/notes/note-thread.logic';

const service = new NoteThreadService();
const ctx = { organizationId: ORG, userId: AUTHOR, canViewPrivate: false, canDeleteAny: false };

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: NOTE,
  organizationId: ORG,
  entityType: 'LOAN',
  entityId: LOAN,
  content: 'Client asked for a payment holiday',
  priority: 'NORMAL',
  isPinned: false,
  isPrivate: false,
  createdBy: AUTHOR,
  createdAt: new Date(),
  editedAt: null,
  deletedAt: null,
  creator: { id: AUTHOR, firstName: 'Tendai', lastName: 'Moyo', avatar: null },
  attachments: [],
  ...overrides,
});

const pdf = {
  originalname: 'payslip.pdf',
  mimetype: 'application/pdf',
  size: 8,
  buffer: Buffer.from('%PDF-1.4'),
};

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(NoteThreadError);
  return error as NoteThreadError;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  db.loan.findFirst.mockResolvedValue({
    id: LOAN,
    loanNumber: 'LN-0001',
    loanOfficerId: OTHER,
    client: { firstName: 'Rudo', lastName: 'Banda', businessName: null },
  });
  storage.upload.mockImplementation(async (_b: unknown, name: string) => ({ path: `org/loans/${LOAN}/notes/x/${name}` }));
  db.note.create.mockImplementation(async ({ data }: any) =>
    stored({
      id: data.id,
      content: data.content,
      isPrivate: data.isPrivate,
      attachments: data.attachments.create.map((a: any, i: number) => ({ id: `att-${i}`, uploadedAt: new Date(), ...a })),
    })
  );
});

describe('posting a message', () => {
  it('only attaches to a record in the caller’s organization', async () => {
    db.loan.findFirst.mockResolvedValue(null);
    const error = await refusal(service.create(ctx, 'LOAN', LOAN, { content: 'hello' }));
    expect(error.httpStatus).toBe(404);
    expect(db.loan.findFirst.mock.calls[0][0].where).toEqual({ id: LOAN, organizationId: ORG });
    expect(db.note.create).not.toHaveBeenCalled();
  });

  it('stores files under the message and records them with it', async () => {
    const note = await service.create(ctx, 'LOAN', LOAN, { content: 'Payslip' }, [pdf]);
    const uploadOptions = storage.upload.mock.calls[0][4];
    const createdId = db.note.create.mock.calls[0][0].data.id;
    expect(uploadOptions).toMatchObject({ organizationId: ORG, entityType: 'loans', entityId: LOAN, fileType: 'NOTE_ATTACHMENT', subEntityId: createdId });
    expect(note.attachments).toHaveLength(1);
    expect(note.attachments[0]).toMatchObject({ fileName: 'payslip.pdf', url: 'https://signed' });
  });

  it('removes uploaded files again when the message cannot be saved', async () => {
    db.note.create.mockRejectedValueOnce(new Error('database down'));
    await expect(service.create(ctx, 'LOAN', LOAN, { content: 'x' }, [pdf, { ...pdf, originalname: 'b.pdf' }])).rejects.toThrow('database down');
    expect(storage.deleteMany).toHaveBeenCalledWith([
      `org/loans/${LOAN}/notes/x/payslip.pdf`,
      `org/loans/${LOAN}/notes/x/b.pdf`,
    ]);
  });

  it('removes the files already uploaded when a later one fails', async () => {
    storage.upload
      .mockResolvedValueOnce({ path: 'first.pdf' })
      .mockRejectedValueOnce(new Error('storage down'));
    const error = await refusal(service.create(ctx, 'LOAN', LOAN, { content: 'x' }, [pdf, pdf]));
    expect(error.code).toBe('UPLOAD_FAILED');
    expect(storage.deleteMany).toHaveBeenCalledWith(['first.pdf']);
    expect(db.note.create).not.toHaveBeenCalled();
  });

  it('marks the thread read for its author', async () => {
    await service.create(ctx, 'LOAN', LOAN, { content: 'hello' });
    expect(db.noteReadMarker.upsert.mock.calls[0][0].create).toMatchObject({ userId: AUTHOR, entityType: 'LOAN', entityId: LOAN });
  });

  it('tells the loan officer, linking straight to the thread', async () => {
    db.note.findMany.mockResolvedValue([{ createdBy: AUTHOR }]);
    db.user.findMany.mockResolvedValue([{ id: OTHER }]);
    await service.create(ctx, 'LOAN', LOAN, { content: 'Client asked for a payment holiday' });
    await new Promise(resolve => setImmediate(resolve));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: OTHER,
        type: 'NOTE_ADDED',
        title: 'Tendai Moyo on Loan LN-0001 · Rudo Banda',
        link: `/loans/${LOAN}?notes=open`,
      })
    );
  });
});

describe('changing a message', () => {
  it('lets the author change their words, and marks it edited', async () => {
    db.note.findFirst.mockResolvedValue(stored());
    db.note.update.mockImplementation(async ({ data }: any) => stored({ ...data }));
    const note = await service.update(ctx, NOTE, { content: 'Client asked for a 1-month holiday' });
    const data = db.note.update.mock.calls[0][0].data;
    expect(data.content).toBe('Client asked for a 1-month holiday');
    expect(data.editedAt).toBeInstanceOf(Date);
    expect(note.content).toBe('Client asked for a 1-month holiday');
    expect(createAuditLog).toHaveBeenCalled();
  });

  it('never lets someone else rewrite it, even a moderator', async () => {
    db.note.findFirst.mockResolvedValue(stored());
    const error = await refusal(
      service.update({ ...ctx, userId: OTHER, canDeleteAny: true }, NOTE, { content: 'rewritten' })
    );
    expect(error.httpStatus).toBe(403);
    expect(db.note.update).not.toHaveBeenCalled();
  });

  it('does not mark a message edited when only a flag changes', async () => {
    db.note.findFirst.mockResolvedValue(stored());
    db.note.update.mockImplementation(async ({ data }: any) => stored({ ...data }));
    await service.update(ctx, NOTE, { priority: 'HIGH' });
    expect(db.note.update.mock.calls[0][0].data.editedAt).toBeUndefined();
  });
});

describe('deleting a message', () => {
  const withFile = () =>
    stored({ attachments: [{ id: 'a1', fileName: 'id.jpg', fileSize: 1, mimeType: 'image/jpeg', uploadedAt: new Date(), storagePath: 'org/x/id.jpg' }] });

  it('hides it rather than erasing it, and removes its files', async () => {
    db.note.findFirst.mockResolvedValue(withFile());
    await service.remove(ctx, NOTE);
    expect(db.note.update.mock.calls[0][0].data).toMatchObject({ deletedBy: AUTHOR, isPinned: false });
    expect(db.note.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    // Hiding the message and dropping its attachment rows happen together.
    expect(db.$transaction.mock.calls[0][0]).toHaveLength(2);
    expect(db.noteAttachment.deleteMany).toHaveBeenCalledWith({ where: { noteId: NOTE } });
    expect(storage.deleteMany).toHaveBeenCalledWith(['org/x/id.jpg']);
  });

  it('keeps the words in the audit trail', async () => {
    db.note.findFirst.mockResolvedValue(withFile());
    await service.remove(ctx, NOTE);
    expect((createAuditLog.mock.calls as any[])[0][0]).toMatchObject({
      action: 'DELETE',
      previousValue: { content: 'Client asked for a payment holiday', attachments: ['id.jpg'] },
    });
  });

  it('refuses someone else’s message without notes:delete_any', async () => {
    db.note.findFirst.mockResolvedValue(stored());
    const error = await refusal(service.remove({ ...ctx, userId: OTHER }, NOTE));
    expect(error.httpStatus).toBe(403);
  });

  it('lets a moderator delete someone else’s message', async () => {
    db.note.findFirst.mockResolvedValue(stored());
    await service.remove({ ...ctx, userId: OTHER, canDeleteAny: true }, NOTE);
    expect(db.$transaction).toHaveBeenCalled();
  });

  it('cannot find a private message the caller may not see', async () => {
    db.note.findFirst.mockResolvedValue(null);
    const error = await refusal(service.remove({ ...ctx, userId: OTHER }, NOTE));
    expect(error.httpStatus).toBe(404);
    expect(db.note.findFirst.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG,
      OR: [{ isPrivate: false }, { createdBy: OTHER }],
    });
  });
});

describe('counts', () => {
  it('asks nothing of the database for an empty page', async () => {
    expect(await service.counts(ctx, 'CLIENT', [])).toEqual({});
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns total and unread per record', async () => {
    db.$queryRaw.mockResolvedValue([{ entityId: LOAN, total: 4, unread: 2 }]);
    expect(await service.counts(ctx, 'LOAN', [LOAN, LOAN])).toEqual({ [LOAN]: { total: 4, unread: 2 } });
  });
});
