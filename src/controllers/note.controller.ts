import { Request, Response } from 'express';
import { noteService } from '../services/note.service';
import { NoteEntityType, NotePriority } from '@prisma/client';
import { PERMISSIONS } from '../constants/permissions';

export class NoteController {
  /**
   * Get notes for an entity
   */
  async getNotes(req: Request, res: Response) {
    try {
      const { entityType, entityId } = req.params;
      const organizationId = (req.user as any)?.organizationId;
      const userId = (req.user as any)?.userId || (req.user as any)?.id;

      if (!organizationId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'User organization or ID not found',
          error: 'NO_USER_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      // Validate entity type
      if (
        !Object.values(NoteEntityType).includes(entityType as NoteEntityType)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid entity type',
          error: 'INVALID_ENTITY_TYPE',
          timestamp: new Date().toISOString(),
        });
      }

      const canViewPrivate =
        (req.user as any)?.permissions?.includes(PERMISSIONS.NOTES_VIEW_PRIVATE) ||
        false;

      const notes = await noteService.getByEntity(
        organizationId,
        entityType as NoteEntityType,
        entityId,
        userId,
        canViewPrivate
      );

      res.json({
        success: true,
        message: 'Notes retrieved successfully',
        data: { notes },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get notes error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Create a new note
   */
  async createNote(req: Request, res: Response) {
    try {
      const { entityType, entityId } = req.params;
      const { content, priority, isPinned, isPrivate } = req.body;
      const organizationId = (req.user as any)?.organizationId;
      const userId = (req.user as any)?.userId || (req.user as any)?.id;

      if (!organizationId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'User organization or ID not found',
          error: 'NO_USER_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      if (!content || content.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Note content is required',
          error: 'VALIDATION_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      // Validate entity type
      if (
        !Object.values(NoteEntityType).includes(entityType as NoteEntityType)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid entity type',
          error: 'INVALID_ENTITY_TYPE',
          timestamp: new Date().toISOString(),
        });
      }

      // Validate priority if provided
      if (priority && !Object.values(NotePriority).includes(priority)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid priority level',
          error: 'VALIDATION_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      const note = await noteService.create({
        organizationId,
        entityType: entityType as NoteEntityType,
        entityId,
        content: content.trim(),
        priority: priority as NotePriority,
        isPinned: isPinned || false,
        isPrivate: isPrivate || false,
        createdBy: userId,
      });

      res.status(201).json({
        success: true,
        message: 'Note created successfully',
        data: { note },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Create note error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update a note
   */
  async updateNote(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { content, priority, isPinned, isPrivate } = req.body;
      const organizationId = (req.user as any)?.organizationId;
      const userId = (req.user as any)?.userId || (req.user as any)?.id;

      if (!organizationId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'User organization or ID not found',
          error: 'NO_USER_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const canUpdateAny =
        req.user?.permissions?.includes(PERMISSIONS.NOTES_DELETE_ANY) || false;

      const updateData: any = {};
      if (content !== undefined) updateData.content = content.trim();
      if (priority !== undefined) updateData.priority = priority;
      if (isPinned !== undefined) updateData.isPinned = isPinned;
      if (isPrivate !== undefined) updateData.isPrivate = isPrivate;

      const note = await noteService.update(
        id,
        organizationId,
        userId,
        updateData,
        canUpdateAny
      );

      res.json({
        success: true,
        message: 'Note updated successfully',
        data: { note },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update note error:', error);
      if (error.message === 'Note not found') {
        return res.status(404).json({
          success: false,
          message: 'Note not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      if (error.message === 'You can only update your own notes') {
        return res.status(403).json({
          success: false,
          message: error.message,
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Delete a note
   */
  async deleteNote(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const organizationId = (req.user as any)?.organizationId;
      const userId = (req.user as any)?.userId || (req.user as any)?.id;

      if (!organizationId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'User organization or ID not found',
          error: 'NO_USER_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const canDeleteAny =
        req.user?.permissions?.includes(PERMISSIONS.NOTES_DELETE_ANY) || false;

      await noteService.delete(id, organizationId, userId, canDeleteAny);

      res.json({
        success: true,
        message: 'Note deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Delete note error:', error);
      if (error.message === 'Note not found') {
        return res.status(404).json({
          success: false,
          message: 'Note not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      if (error.message === 'You can only delete your own notes') {
        return res.status(403).json({
          success: false,
          message: error.message,
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Toggle pin status
   */
  async togglePin(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const organizationId = (req.user as any)?.organizationId;
      const userId = (req.user as any)?.userId || (req.user as any)?.id;

      if (!organizationId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'User organization or ID not found',
          error: 'NO_USER_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const canUpdateAny =
        req.user?.permissions?.includes(PERMISSIONS.NOTES_DELETE_ANY) || false;

      const note = await noteService.togglePin(
        id,
        organizationId,
        userId,
        canUpdateAny
      );

      res.json({
        success: true,
        message: `Note ${note.isPinned ? 'pinned' : 'unpinned'} successfully`,
        data: { note },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Toggle pin error:', error);
      if (error.message === 'Note not found') {
        return res.status(404).json({
          success: false,
          message: 'Note not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get notes count for an entity
   */
  async getNotesCount(req: Request, res: Response) {
    try {
      const { entityType, entityId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User organization not found',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Validate entity type
      if (
        !Object.values(NoteEntityType).includes(entityType as NoteEntityType)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid entity type',
          error: 'INVALID_ENTITY_TYPE',
          timestamp: new Date().toISOString(),
        });
      }

      const count = await noteService.getCount(
        organizationId,
        entityType as NoteEntityType,
        entityId
      );

      res.json({
        success: true,
        message: 'Notes count retrieved successfully',
        data: { count },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get notes count error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const noteController = new NoteController();
