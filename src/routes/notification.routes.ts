/**
 * Notification Routes
 * API endpoints for notification management
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware';
import { validateRequest, handleAsync } from '../middleware/validation.middleware';
import { notificationService } from '../services/notification.service';
import { runJob, getJobDefinitions } from '../jobs/notification.jobs';
import { NOTIFICATION_TEMPLATES } from '../templates/notification.templates';

const router = Router();

// All notification routes require authentication
router.use(authenticateToken);

/**
 * Send SMS notification
 * POST /api/notifications/sms
 */
const sendSMSSchema = z.object({
  body: z.object({
    to: z.string().min(10, 'Phone number required'),
    message: z.string().min(1).max(480).optional(),
    templateId: z.string().optional(),
    data: z.record(z.any()).optional(),
  }).refine(
    (data) => data.message || data.templateId,
    'Either message or templateId is required'
  ),
});

router.post(
  '/sms',
  requirePermission('notifications:send'),
  validateRequest(sendSMSSchema),
  handleAsync(async (req, res) => {
    const { to, message, templateId, data } = req.body;

    let result;
    if (templateId && data) {
      result = await notificationService.sendSMSFromTemplate(to, templateId, data);
    } else if (message) {
      result = await notificationService.sendSMS(to, message);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Message or template required',
      });
    }

    res.json({
      success: result.success,
      data: {
        messageId: result.messageId,
        provider: result.provider,
        destination: result.destination,
        timestamp: result.timestamp,
      },
      error: result.error,
    });
  })
);

/**
 * Send email notification
 * POST /api/notifications/email
 */
const sendEmailSchema = z.object({
  body: z.object({
    to: z.string().email('Valid email required'),
    subject: z.string().min(1).max(200).optional(),
    message: z.string().min(1).optional(),
    templateId: z.string().optional(),
    data: z.record(z.any()).optional(),
  }).refine(
    (data) => data.message || data.templateId,
    'Either message or templateId is required'
  ),
});

router.post(
  '/email',
  requirePermission('notifications:send'),
  validateRequest(sendEmailSchema),
  handleAsync(async (req, res) => {
    const { to, subject, message, templateId, data } = req.body;

    let result;
    if (templateId && data) {
      result = await notificationService.sendEmailFromTemplate(to, templateId, data);
    } else if (message && subject) {
      result = await notificationService.sendEmail(to, subject, message);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Subject/message or template required',
      });
    }

    res.json({
      success: result.success,
      data: {
        messageId: result.messageId,
        timestamp: result.timestamp,
      },
      error: result.error,
    });
  })
);

/**
 * Queue notification for later
 * POST /api/notifications/queue
 */
const queueNotificationSchema = z.object({
  body: z.object({
    type: z.enum(['SMS', 'EMAIL']),
    to: z.string().min(1, 'Recipient required'),
    subject: z.string().optional(),
    message: z.string().optional(),
    templateId: z.string().optional(),
    data: z.record(z.any()).optional(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    scheduledAt: z.string().datetime().optional().transform((v) => v ? new Date(v) : undefined),
  }).refine(
    (data) => data.message || data.templateId,
    'Either message or templateId is required'
  ),
});

router.post(
  '/queue',
  requirePermission('notifications:send'),
  validateRequest(queueNotificationSchema),
  handleAsync(async (req, res) => {
    const notificationId = await notificationService.queueNotification(req.body);

    res.status(202).json({
      success: true,
      data: {
        notificationId,
        status: 'QUEUED',
        scheduledAt: req.body.scheduledAt,
      },
    });
  })
);

/**
 * Send bulk notifications
 * POST /api/notifications/bulk
 */
const bulkNotificationSchema = z.object({
  body: z.object({
    type: z.enum(['SMS', 'EMAIL']),
    recipients: z.array(
      z.object({
        to: z.string().min(1),
        data: z.record(z.any()).optional(),
      })
    ).min(1).max(1000),
    templateId: z.string().min(1),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  }),
});

router.post(
  '/bulk',
  requirePermission('notifications:bulk'),
  validateRequest(bulkNotificationSchema),
  handleAsync(async (req, res) => {
    const { type, recipients, templateId, priority } = req.body;

    const result = await notificationService.sendBulk(type, recipients, templateId, priority);

    res.status(202).json({
      success: true,
      data: {
        queued: result.queued,
        failed: result.failed,
        total: recipients.length,
      },
    });
  })
);

/**
 * Get notification queue statistics
 * GET /api/notifications/queue/stats
 */
router.get(
  '/queue/stats',
  requirePermission('notifications:view'),
  handleAsync(async (req, res) => {
    const stats = await notificationService.getQueueStats();

    res.json({
      success: true,
      data: stats,
    });
  })
);

/**
 * Get SMS provider balances
 * GET /api/notifications/sms/balance
 */
router.get(
  '/sms/balance',
  requirePermission('notifications:view'),
  handleAsync(async (req, res) => {
    const balances = await notificationService.getSMSBalance();

    res.json({
      success: true,
      data: balances,
    });
  })
);

/**
 * Get available notification templates
 * GET /api/notifications/templates
 */
router.get(
  '/templates',
  requirePermission('notifications:view'),
  handleAsync(async (req, res) => {
    const templates = Object.entries(NOTIFICATION_TEMPLATES).map(([key, template]) => ({
      key,
      id: template.id,
      name: template.name,
      type: template.type,
      variables: template.variables,
      hasSubject: !!template.subject,
    }));

    res.json({
      success: true,
      data: templates,
    });
  })
);

/**
 * Preview a notification template
 * POST /api/notifications/templates/:templateId/preview
 */
const previewTemplateSchema = z.object({
  body: z.object({
    data: z.record(z.any()),
  }),
  params: z.object({
    templateId: z.string(),
  }),
});

router.post(
  '/templates/:templateId/preview',
  requirePermission('notifications:view'),
  validateRequest(previewTemplateSchema),
  handleAsync(async (req, res) => {
    const templateId = req.params.templateId!;
    const { data } = req.body;

    const template = NOTIFICATION_TEMPLATES[templateId as keyof typeof NOTIFICATION_TEMPLATES];
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    const { compileTemplate } = await import('../templates/notification.templates');

    res.json({
      success: true,
      data: {
        sms: compileTemplate(template.smsTemplate, data),
        email: {
          subject: template.subject ? compileTemplate(template.subject, data) : template.name,
          body: compileTemplate(template.emailTemplate, data),
        },
      },
    });
  })
);

/**
 * Get scheduled job definitions
 * GET /api/notifications/jobs
 */
router.get(
  '/jobs',
  requirePermission('notifications:manage'),
  handleAsync(async (req, res) => {
    const jobs = getJobDefinitions();

    res.json({
      success: true,
      data: jobs,
    });
  })
);

/**
 * Run a scheduled job manually
 * POST /api/notifications/jobs/:jobName/run
 */
const runJobSchema = z.object({
  params: z.object({
    jobName: z.string(),
  }),
});

router.post(
  '/jobs/:jobName/run',
  requirePermission('notifications:manage'),
  validateRequest(runJobSchema),
  handleAsync(async (req, res) => {
    const jobName = req.params.jobName!;

    const result = await runJob(jobName);

    res.json({
      success: result.success,
      data: {
        jobName,
        processed: result.processed,
        details: result.details,
      },
      error: result.error,
    });
  })
);

export default router;
