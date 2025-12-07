import { prisma } from '../config/database';
import {
  Note,
  NoteAttachment,
  NoteEntityType,
  NotePriority,
} from '@prisma/client';

export interface CreateNoteData {
  organizationId: string;
  entityType: NoteEntityType;
  entityId: string;
  content: string;
  priority?: NotePriority;
  isPinned?: boolean;
  isPrivate?: boolean;
  createdBy: string;
}

export interface UpdateNoteData {
  content?: string;
  priority?: NotePriority;
  isPinned?: boolean;
  isPrivate?: boolean;
}

export interface NoteWithCreator extends Note {
  creator: {
    id: string;
    firstName: string;
    lastName: string;
    avatar: string | null;
  };
  attachments: NoteAttachment[];
}

export interface CreateAttachmentData {
  noteId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  uploadedBy: string;
}

export class NoteService {
  /**
   * Create a new note
   */
  async create(data: CreateNoteData): Promise<NoteWithCreator> {
    const note = await prisma.note.create({
      data: {
        organizationId: data.organizationId,
        entityType: data.entityType,
        entityId: data.entityId,
        content: data.content,
        priority: data.priority || 'NORMAL',
        isPinned: data.isPinned || false,
        isPrivate: data.isPrivate || false,
        createdBy: data.createdBy,
      },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        attachments: true,
      },
    });

    return note as NoteWithCreator;
  }

  /**
   * Get all notes for an entity
   */
  async getByEntity(
    organizationId: string,
    entityType: NoteEntityType,
    entityId: string,
    userId: string,
    canViewPrivate: boolean = false
  ): Promise<NoteWithCreator[]> {
    const where: any = {
      organizationId,
      entityType,
      entityId,
    };

    // If user cannot view private notes, only show public notes OR their own private notes
    if (!canViewPrivate) {
      where.OR = [{ isPrivate: false }, { isPrivate: true, createdBy: userId }];
    }

    const notes = await prisma.note.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        attachments: true,
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    });

    return notes as NoteWithCreator[];
  }

  /**
   * Get a single note by ID
   */
  async getById(
    id: string,
    organizationId: string
  ): Promise<NoteWithCreator | null> {
    const note = await prisma.note.findFirst({
      where: { id, organizationId },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        attachments: true,
      },
    });

    return note as NoteWithCreator | null;
  }

  /**
   * Update a note
   */
  async update(
    id: string,
    organizationId: string,
    userId: string,
    data: UpdateNoteData,
    canUpdateAny: boolean = false
  ): Promise<NoteWithCreator> {
    // First check if the note exists and belongs to the user (or user can update any)
    const existingNote = await prisma.note.findFirst({
      where: { id, organizationId },
    });

    if (!existingNote) {
      throw new Error('Note not found');
    }

    if (!canUpdateAny && existingNote.createdBy !== userId) {
      throw new Error('You can only update your own notes');
    }

    const note = await prisma.note.update({
      where: { id },
      data,
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        attachments: true,
      },
    });

    return note as NoteWithCreator;
  }

  /**
   * Delete a note
   */
  async delete(
    id: string,
    organizationId: string,
    userId: string,
    canDeleteAny: boolean = false
  ): Promise<void> {
    const existingNote = await prisma.note.findFirst({
      where: { id, organizationId },
    });

    if (!existingNote) {
      throw new Error('Note not found');
    }

    if (!canDeleteAny && existingNote.createdBy !== userId) {
      throw new Error('You can only delete your own notes');
    }

    // Attachments will be cascade deleted
    await prisma.note.delete({ where: { id } });
  }

  /**
   * Toggle pin status
   */
  async togglePin(
    id: string,
    organizationId: string,
    userId: string,
    canUpdateAny: boolean = false
  ): Promise<NoteWithCreator> {
    const existingNote = await prisma.note.findFirst({
      where: { id, organizationId },
    });

    if (!existingNote) {
      throw new Error('Note not found');
    }

    if (!canUpdateAny && existingNote.createdBy !== userId) {
      throw new Error('You can only update your own notes');
    }

    const note = await prisma.note.update({
      where: { id },
      data: { isPinned: !existingNote.isPinned },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        attachments: true,
      },
    });

    return note as NoteWithCreator;
  }

  /**
   * Add attachment to a note
   */
  async addAttachment(data: CreateAttachmentData): Promise<NoteAttachment> {
    return prisma.noteAttachment.create({
      data,
    });
  }

  /**
   * Remove attachment from a note
   */
  async removeAttachment(
    attachmentId: string,
    userId: string,
    canDeleteAny: boolean = false
  ): Promise<void> {
    const attachment = await prisma.noteAttachment.findUnique({
      where: { id: attachmentId },
      include: { note: true },
    });

    if (!attachment) {
      throw new Error('Attachment not found');
    }

    if (!canDeleteAny && attachment.uploadedBy !== userId) {
      throw new Error('You can only delete your own attachments');
    }

    await prisma.noteAttachment.delete({ where: { id: attachmentId } });
  }

  /**
   * Get notes count for an entity
   */
  async getCount(
    organizationId: string,
    entityType: NoteEntityType,
    entityId: string
  ): Promise<number> {
    return prisma.note.count({
      where: { organizationId, entityType, entityId },
    });
  }

  /**
   * Get recent notes across all entities for a user/organization
   */
  async getRecent(
    organizationId: string,
    limit: number = 10
  ): Promise<NoteWithCreator[]> {
    const notes = await prisma.note.findMany({
      where: { organizationId },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        attachments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return notes as NoteWithCreator[];
  }
}

export const noteService = new NoteService();
