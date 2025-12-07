import { Router } from 'express';
import { noteController } from '../controllers/note.controller';
import { authenticate } from '../middleware/auth';
import { loadPermissions, requirePermission } from '../middleware/permissions';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Notes
 *   description: Notes management - attach notes to clients, loans, payments, etc.
 */

/**
 * @swagger
 * /api/v1/notes/{entityType}/{entityId}:
 *   get:
 *     summary: Get all notes for an entity
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [CLIENT, LOAN, PAYMENT, DISBURSEMENT, LOAN_APPLICATION, COLLATERAL, GROUP]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notes retrieved successfully
 */
router.get(
  '/:entityType/:entityId',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.NOTES_VIEW),
  noteController.getNotes.bind(noteController)
);

/**
 * @swagger
 * /api/v1/notes/{entityType}/{entityId}:
 *   post:
 *     summary: Create a new note for an entity
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [CLIENT, LOAN, PAYMENT, DISBURSEMENT, LOAN_APPLICATION, COLLATERAL, GROUP]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 description: Note content
 *               priority:
 *                 type: string
 *                 enum: [LOW, NORMAL, HIGH, URGENT]
 *                 default: NORMAL
 *               isPinned:
 *                 type: boolean
 *                 default: false
 *               isPrivate:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       201:
 *         description: Note created successfully
 */
router.post(
  '/:entityType/:entityId',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.NOTES_CREATE),
  noteController.createNote.bind(noteController)
);

/**
 * @swagger
 * /api/v1/notes/{entityType}/{entityId}/count:
 *   get:
 *     summary: Get notes count for an entity
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [CLIENT, LOAN, PAYMENT, DISBURSEMENT, LOAN_APPLICATION, COLLATERAL, GROUP]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notes count retrieved
 */
router.get(
  '/:entityType/:entityId/count',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.NOTES_VIEW),
  noteController.getNotesCount.bind(noteController)
);

/**
 * @swagger
 * /api/v1/notes/{id}:
 *   put:
 *     summary: Update a note
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [LOW, NORMAL, HIGH, URGENT]
 *               isPinned:
 *                 type: boolean
 *               isPrivate:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Note updated successfully
 */
router.put(
  '/:id',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.NOTES_UPDATE),
  noteController.updateNote.bind(noteController)
);

/**
 * @swagger
 * /api/v1/notes/{id}:
 *   delete:
 *     summary: Delete a note
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Note deleted successfully
 */
router.delete(
  '/:id',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.NOTES_DELETE),
  noteController.deleteNote.bind(noteController)
);

/**
 * @swagger
 * /api/v1/notes/{id}/toggle-pin:
 *   patch:
 *     summary: Toggle pin status of a note
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Note pin status toggled
 */
router.patch(
  '/:id/toggle-pin',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.NOTES_UPDATE),
  noteController.togglePin.bind(noteController)
);

export default router;
