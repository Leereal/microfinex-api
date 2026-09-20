/**
 * OBSE bank statement analysis.
 *
 *   GET  /obse/status                         is OBSE active here? (any user)
 *   GET  /obse/settings                       configuration, key masked
 *   PUT  /obse/settings                       activate, set key / base URL
 *   POST /obse/settings/test                  check a key without analysing
 *   GET  /obse/clients/:clientId/defaults     pre-fill for the analyse form
 *   GET  /obse/clients/:clientId/analyses     a client's analyses
 *   POST /obse/clients/:clientId/analyses     start an analysis
 *   GET  /obse/analyses/:analysisId           one analysis, full response
 *   PUT  /obse/analyses/:analysisId/adjustments  a reviewer's line decisions
 *
 * The organization always comes from the session, never from the request.
 *
 * Permissions reuse the document grants rather than adding new ones: an
 * analysis is read out of a client's documents, so whoever may see those may
 * see what was found in them, and running one is the same act as extracting
 * data from a document - `documents:extract`.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  authenticateToken,
  requirePermission,
} from '../middleware/auth.middleware';
import {
  handleAsync,
  validateFullRequest,
} from '../middleware/validation.middleware';
import { obseService } from '../services/obse/obse.service';
import {
  AnalysisRequestError,
  CUSTOMER_TYPES,
} from '../services/obse/obse.logic';

const router = Router();

router.use(authenticateToken);

const now = () => new Date().toISOString();

/** The caller's organization, or a 400 already sent. */
function organizationOf(req: Request, res: Response): string | null {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    res.status(400).json({
      success: false,
      message: 'Organization context required',
      error: 'MISSING_ORGANIZATION',
      timestamp: now(),
    });
    return null;
  }
  return organizationId;
}

/** Turn an expected refusal into its status code; let anything else through. */
const handle = (
  fn: (req: Request, res: Response, organizationId: string) => Promise<unknown>
) =>
  handleAsync(async (req, res) => {
    const organizationId = organizationOf(req, res);
    if (!organizationId) return;
    try {
      await fn(req, res, organizationId);
    } catch (error) {
      if (error instanceof AnalysisRequestError) {
        res.status(error.httpStatus).json({
          success: false,
          message: error.message,
          error: error.code,
          timestamp: now(),
        });
        return;
      }
      throw error;
    }
  });

const uuid = z.string().uuid();

// ------------------------------------------------------------------ status
router.get(
  '/status',
  handle(async (_req, res, organizationId) => {
    res.json({
      success: true,
      data: { active: await obseService.isActive(organizationId) },
      timestamp: now(),
    });
  })
);

// ---------------------------------------------------------------- settings
router.get(
  '/settings',
  requirePermission('settings:view'),
  handle(async (_req, res, organizationId) => {
    res.json({
      success: true,
      data: await obseService.getPublicSettings(organizationId),
      timestamp: now(),
    });
  })
);

router.put(
  '/settings',
  requirePermission('settings:update'),
  validateFullRequest({
    body: z
      .object({
        enabled: z.boolean().optional(),
        apiKey: z.string().max(512).nullable().optional(),
        baseUrl: z.string().max(255).nullable().optional(),
      })
      .strict(),
  }),
  handle(async (req, res, organizationId) => {
    const settings = await obseService.updateSettings(
      organizationId,
      req.user!.userId,
      req.body
    );
    res.json({
      success: true,
      message: 'OBSE settings saved',
      data: settings,
      timestamp: now(),
    });
  })
);

router.post(
  '/settings/test',
  requirePermission('settings:update'),
  validateFullRequest({
    body: z
      .object({
        apiKey: z.string().max(512).optional(),
        baseUrl: z.string().max(255).optional(),
      })
      .strict(),
  }),
  handle(async (req, res, organizationId) => {
    const result = await obseService.testConnection(organizationId, req.body);
    res.json({ success: true, data: result, timestamp: now() });
  })
);

// ---------------------------------------------------------------- analyses
const clientParams = z.object({ clientId: uuid });

router.get(
  '/clients/:clientId/defaults',
  requirePermission('documents:view'),
  validateFullRequest({ params: clientParams }),
  handle(async (req, res, organizationId) => {
    res.json({
      success: true,
      data: await obseService.getAnalysisDefaults(
        organizationId,
        req.params.clientId!
      ),
      timestamp: now(),
    });
  })
);

router.get(
  '/clients/:clientId/analyses',
  requirePermission('documents:view'),
  validateFullRequest({ params: clientParams }),
  handle(async (req, res, organizationId) => {
    res.json({
      success: true,
      data: await obseService.listForClient(
        organizationId,
        req.params.clientId!
      ),
      timestamp: now(),
    });
  })
);

router.post(
  '/clients/:clientId/analyses',
  requirePermission('documents:extract'),
  validateFullRequest({
    params: clientParams,
    body: z
      .object({
        statementDocumentIds: z.array(uuid).min(1).max(12),
        payslipDocumentIds: z.array(uuid).max(12).default([]),
        customerType: z.enum(CUSTOMER_TYPES).optional(),
        // Used for this one request, never stored.
        pdfPassword: z.string().min(1).max(128).optional(),
      })
      .strict(),
  }),
  handle(async (req, res, organizationId) => {
    const analysis = await obseService.requestAnalysis({
      organizationId,
      clientId: req.params.clientId!,
      userId: req.user!.userId,
      statementDocumentIds: req.body.statementDocumentIds,
      payslipDocumentIds: req.body.payslipDocumentIds,
      customerType: req.body.customerType,
      pdfPassword: req.body.pdfPassword,
    });
    res.status(202).json({
      success: true,
      message:
        'Analysis started. It usually takes a minute or two; you will be notified when it is ready.',
      data: analysis,
      timestamp: now(),
    });
  })
);

router.put(
  '/analyses/:analysisId/adjustments',
  requirePermission('documents:extract'),
  validateFullRequest({
    params: z.object({ analysisId: uuid }),
    body: z
      .object({
        // Transaction id -> counted. An empty map returns to OBSE's figures.
        overrides: z
          .record(z.string().min(1).max(64), z.boolean())
          .refine(value => Object.keys(value).length <= 10_000, {
            message: 'Too many adjusted lines',
          }),
      })
      .strict(),
  }),
  handle(async (req, res, organizationId) => {
    const analysis = await obseService.saveAdjustments(
      organizationId,
      req.params.analysisId!,
      req.user!.userId,
      req.body.overrides
    );
    res.json({
      success: true,
      message: 'Adjustments saved',
      data: analysis,
      timestamp: now(),
    });
  })
);

router.get(
  '/analyses/:analysisId',
  requirePermission('documents:view'),
  validateFullRequest({ params: z.object({ analysisId: uuid }) }),
  handle(async (req, res, organizationId) => {
    res.json({
      success: true,
      data: await obseService.getById(organizationId, req.params.analysisId!),
      timestamp: now(),
    });
  })
);

export default router;
