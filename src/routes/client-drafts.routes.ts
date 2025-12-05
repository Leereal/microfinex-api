import { Router } from 'express';
import { authenticate } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import {
  clientDraftService,
  saveDraftSchema,
  updateDraftFieldSchema,
} from '../services/client-draft.service';

const router = Router();

/**
 * @swagger
 * /api/v1/client-drafts:
 *   get:
 *     summary: Get current user's client draft
 *     tags: [Client Drafts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Draft retrieved successfully
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.userContext?.id;
    const organizationId = req.userContext?.organizationId;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User context required',
        error: 'MISSING_CONTEXT',
        timestamp: new Date().toISOString(),
      });
    }

    const draft = await clientDraftService.getDraft(userId, organizationId);

    res.json({
      success: true,
      message: draft ? 'Draft retrieved successfully' : 'No draft found',
      data: { draft },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get draft error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve draft',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/client-drafts:
 *   post:
 *     summary: Save client draft
 *     tags: [Client Drafts]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticate,
  validateRequest(saveDraftSchema),
  async (req, res) => {
    try {
      const userId = req.userContext?.id;
      const organizationId = req.userContext?.organizationId;
      const branchId = req.userContext?.appUser?.branchId || null;

      if (!userId || !organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User context required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const { draftData, lastFieldUpdated } = req.body;

      const draft = await clientDraftService.saveDraft(
        userId,
        organizationId,
        branchId,
        draftData,
        lastFieldUpdated
      );

      res.json({
        success: true,
        message: 'Draft saved successfully',
        data: { draft },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Save draft error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save draft',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/client-drafts/field:
 *   patch:
 *     summary: Update a single field in the draft
 *     tags: [Client Drafts]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  '/field',
  authenticate,
  validateRequest(updateDraftFieldSchema),
  async (req, res) => {
    try {
      const userId = req.userContext?.id;
      const organizationId = req.userContext?.organizationId;
      const branchId = req.userContext?.appUser?.branchId || null;

      if (!userId || !organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User context required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const { fieldPath, value } = req.body;

      const draft = await clientDraftService.updateDraftField(
        userId,
        organizationId,
        branchId,
        fieldPath,
        value
      );

      res.json({
        success: true,
        message: 'Field updated successfully',
        data: { draft },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update field error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update field',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/client-drafts:
 *   delete:
 *     summary: Delete current user's draft
 *     tags: [Client Drafts]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/', authenticate, async (req, res) => {
  try {
    const userId = req.userContext?.id;
    const organizationId = req.userContext?.organizationId;

    if (!userId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User context required',
        error: 'MISSING_CONTEXT',
        timestamp: new Date().toISOString(),
      });
    }

    const deleted = await clientDraftService.deleteDraft(
      userId,
      organizationId
    );

    res.json({
      success: true,
      message: deleted ? 'Draft deleted successfully' : 'No draft to delete',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Delete draft error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete draft',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
