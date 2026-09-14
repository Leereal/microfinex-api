import {
  MAX_ATTACHMENTS_PER_NOTE,
  NoteThreadError,
  normaliseContent,
  notificationRecipients,
  presentNote,
  previewText,
  safeFileName,
  validateAttachments,
  visibleTo,
  type StoredNote,
} from '../src/services/notes/note-thread.logic';

/** The rules of the discussion threads on clients and loans. */

const refusal = (fn: () => unknown): NoteThreadError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof NoteThreadError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
};

const file = (overrides: Partial<{ originalname: string; mimetype: string; size: number }> = {}) => ({
  originalname: 'payslip.pdf',
  mimetype: 'application/pdf',
  size: 1000,
  ...overrides,
});

describe('attachments', () => {
  it('accepts photos, PDFs, office files and text', () => {
    expect(() =>
      validateAttachments([
        file(),
        file({ originalname: 'house.jpg', mimetype: 'image/jpeg' }),
        file({ originalname: 'budget.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        file({ originalname: 'notes.txt', mimetype: 'text/plain' }),
      ])
    ).not.toThrow();
  });

  it('refuses anything a browser could run', () => {
    expect(refusal(() => validateAttachments([file({ originalname: 'x.html', mimetype: 'text/html' })])).code).toBe('UNSUPPORTED_ATTACHMENT');
    expect(refusal(() => validateAttachments([file({ originalname: 'x.svg', mimetype: 'image/svg+xml' })])).code).toBe('UNSUPPORTED_ATTACHMENT');
  });

  it('refuses a file over 10MB, and an empty one', () => {
    expect(refusal(() => validateAttachments([file({ size: 10 * 1024 * 1024 + 1 })])).code).toBe('ATTACHMENT_TOO_LARGE');
    expect(refusal(() => validateAttachments([file({ size: 0 })])).code).toBe('EMPTY_ATTACHMENT');
  });

  it(`refuses more than ${MAX_ATTACHMENTS_PER_NOTE} files on one message`, () => {
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_NOTE + 1 }, () => file());
    expect(refusal(() => validateAttachments(files)).code).toBe('TOO_MANY_ATTACHMENTS');
  });

  it('keeps a file name readable but harmless', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('bank "statement".pdf')).toBe('bank statement.pdf');
    expect(safeFileName('')).toBe('attachment');
    const long = `${'a'.repeat(300)}.pdf`;
    expect(safeFileName(long)).toHaveLength(150);
    expect(safeFileName(long).endsWith('.pdf')).toBe(true);
  });
});

describe('message content', () => {
  it('needs words or a file', () => {
    expect(refusal(() => normaliseContent('   ', 0)).code).toBe('EMPTY_MESSAGE');
    expect(normaliseContent('', 1)).toBe('');
    expect(normaliseContent('  Client called back  ', 0)).toBe('Client called back');
  });

  it('has a length limit', () => {
    expect(refusal(() => normaliseContent('x'.repeat(5001), 0)).code).toBe('MESSAGE_TOO_LONG');
  });

  it('previews on one line for a notification', () => {
    expect(previewText('Line one\n\nline two', 0)).toBe('Line one line two');
    expect(previewText('', 1)).toBe('Sent an attachment');
    expect(previewText('', 3)).toBe('Sent 3 attachments');
    expect(previewText('x'.repeat(200), 0)).toHaveLength(120);
  });
});

describe('private messages', () => {
  it('are seen by their author', () => {
    expect(visibleTo({ userId: 'u1', canViewPrivate: false, canDeleteAny: false })).toEqual({
      OR: [{ isPrivate: false }, { createdBy: 'u1' }],
    });
  });

  it('are seen by everyone holding notes:view_private', () => {
    expect(visibleTo({ userId: 'u1', canViewPrivate: true, canDeleteAny: false })).toEqual({});
  });
});

describe('presenting a message', () => {
  const stored: StoredNote = {
    id: 'n1',
    content: 'Visited the business, stock looks good',
    priority: 'NORMAL',
    isPinned: true,
    isPrivate: false,
    createdBy: 'author',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    editedAt: null,
    deletedAt: null,
    creator: { id: 'author', firstName: 'Tendai', lastName: 'Moyo', avatar: null },
    attachments: [
      { id: 'a1', fileName: 'shop.jpg', fileSize: 100, mimeType: 'image/jpeg', uploadedAt: new Date() },
    ],
  };
  const urls = new Map([['a1', { url: 'https://s/inline', downloadUrl: 'https://s/download' }]]);

  it('lets the author edit and delete', () => {
    const view = presentNote(stored, { userId: 'author', canViewPrivate: false, canDeleteAny: false }, urls);
    expect(view).toMatchObject({ isOwn: true, canEdit: true, canDelete: true });
    expect(view.attachments[0]).toMatchObject({ url: 'https://s/inline', downloadUrl: 'https://s/download' });
  });

  it('never lets anyone else edit, but a moderator may delete', () => {
    expect(presentNote(stored, { userId: 'other', canViewPrivate: false, canDeleteAny: false })).toMatchObject({
      isOwn: false,
      canEdit: false,
      canDelete: false,
    });
    expect(presentNote(stored, { userId: 'other', canViewPrivate: false, canDeleteAny: true })).toMatchObject({
      canEdit: false,
      canDelete: true,
    });
  });

  it('keeps a deleted message’s place but not its words or files', () => {
    const view = presentNote(
      { ...stored, deletedAt: new Date() },
      { userId: 'author', canViewPrivate: false, canDeleteAny: false },
      urls
    );
    expect(view).toMatchObject({ isDeleted: true, content: '', isPinned: false, canEdit: false, canDelete: false });
    expect(view.attachments).toEqual([]);
    expect(view.author.firstName).toBe('Tendai');
  });

  it('never hands out where a file is stored', () => {
    const view = presentNote(stored, { userId: 'author', canViewPrivate: false, canDeleteAny: false }, urls);
    expect(JSON.stringify(view)).not.toContain('storagePath');
  });
});

describe('who is notified', () => {
  it('tells everyone in the thread and the record’s owner, once each, never the author', () => {
    expect(
      notificationRecipients({
        authorId: 'me',
        isPrivate: false,
        participantIds: ['me', 'colleague', 'officer'],
        ownerIds: ['officer', null],
      }).sort()
    ).toEqual(['colleague', 'officer']);
  });

  it('tells the owner even when nobody has replied yet', () => {
    expect(
      notificationRecipients({ authorId: 'me', isPrivate: false, participantIds: ['me'], ownerIds: ['officer'] })
    ).toEqual(['officer']);
  });

  it('tells no one about a private message', () => {
    expect(
      notificationRecipients({ authorId: 'me', isPrivate: true, participantIds: ['colleague'], ownerIds: ['officer'] })
    ).toEqual([]);
  });
});
