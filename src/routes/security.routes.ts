import { Router, Request, Response } from 'express';
import {
  authenticateSupabase,
  authorizeSupabase,
} from '../middleware/auth-supabase';
import { emailVerificationService } from '../services/security/email-verification.service';
import { passwordPolicyService } from '../services/security/password-policy.service';
import { sessionManagementService } from '../services/security/session-management.service';
import { apiKeyIPWhitelistService } from '../middleware/api-key-ip-whitelist.middleware';
import {
  getRateLimitStatus,
  resetRateLimit,
  getAllRateLimits,
} from '../middleware/rate-limit.middleware';
import { supabaseAdmin } from '../config/supabase-enhanced';
import { UserRole } from '../types';

const router = Router();

// ============================================
// EMAIL VERIFICATION ROUTES
// ============================================

/**
 * Send verification email
 * POST /api/security/email/verify/send
 */
router.post(
  '/email/verify/send',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;

      if (user.isEmailVerified || user.appUser?.isEmailVerified) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'ALREADY_VERIFIED',
            message: 'Email is already verified',
          },
        });
      }

      const result = await emailVerificationService.createVerificationToken(
        user.id
      );

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({
        success: true,
        message: 'Verification email sent',
        data: { expiresAt: result.data?.expiresAt },
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Verify email with token
 * POST /api/security/email/verify
 */
router.post('/email/verify', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Verification token is required',
        },
      });
    }

    const result = await emailVerificationService.verifyToken(token);

    if (!result.success) {
      return res
        .status(400)
        .json({ success: false, error: { message: result.message } });
    }

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

/**
 * Resend verification email
 * POST /api/security/email/verify/resend
 */
router.post(
  '/email/verify/resend',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;

      const result = await emailVerificationService.resendVerification(user.id);

      if (!result.success) {
        return res
          .status(429)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({ success: true, message: 'Verification email resent' });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Get email verification status
 * GET /api/security/email/verify/status
 */
router.get(
  '/email/verify/status',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;

      res.json({
        success: true,
        data: {
          email: user.email,
          isVerified:
            user.isEmailVerified || user.appUser?.isEmailVerified || false,
        },
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

// ============================================
// PASSWORD POLICY ROUTES
// ============================================

/**
 * Get password policy
 * GET /api/security/password/policy
 */
router.get('/password/policy', async (req: Request, res: Response) => {
  try {
    const organizationId = req.query.organizationId as string | undefined;
    const policy = await passwordPolicyService.loadPolicy(organizationId);

    // Remove internal details
    const publicPolicy = {
      minLength: policy.minLength,
      requireUppercase: policy.requireUppercase,
      requireLowercase: policy.requireLowercase,
      requireNumbers: policy.requireNumbers,
      requireSpecialChars: policy.requireSpecialChars,
      maxAgeDays: policy.maxAgeDays,
    };

    res.json({ success: true, data: { policy: publicPolicy } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

/**
 * Validate password strength
 * POST /api/security/password/validate
 */
router.post('/password/validate', async (req: Request, res: Response) => {
  try {
    const { password, organizationId } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: { message: 'Password is required' },
      });
    }

    if (organizationId) {
      await passwordPolicyService.loadPolicy(organizationId);
    }

    const result = passwordPolicyService.validatePassword(password);

    res.json({
      success: true,
      data: {
        valid: result.valid,
        strength: result.strength,
        score: result.score,
        errors: result.errors,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

/**
 * Check password expiration
 * GET /api/security/password/expiration
 */
router.get(
  '/password/expiration',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;
      const result = await passwordPolicyService.isPasswordExpired(user.id);

      res.json({
        success: true,
        data: result.data || { expired: !result.success },
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Change password with policy validation
 * POST /api/security/password/change
 */
router.post(
  '/password/change',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: { message: 'Current password and new password are required' },
        });
      }

      const result = await passwordPolicyService.processPasswordChange(
        user.id,
        currentPassword,
        newPassword,
        user.organizationId
      );

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: { message: result.message, details: result.data },
        });
      }

      res.json({
        success: true,
        message: 'Password changed successfully',
        data: result.data,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Update organization password policy (admin only)
 * PUT /api/security/password/policy
 */
router.put(
  '/password/policy',
  authenticateSupabase,
  authorizeSupabase(UserRole.ADMIN, UserRole.ORG_ADMIN),
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;
      const { policy } = req.body;

      if (!user.organizationId) {
        return res.status(400).json({
          success: false,
          error: { message: 'Organization context required' },
        });
      }

      const result = await passwordPolicyService.updatePolicy(
        user.organizationId,
        policy,
        user.id
      );

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({
        success: true,
        message: 'Password policy updated',
        data: result.data,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

// ============================================
// SESSION MANAGEMENT ROUTES
// ============================================

/**
 * Get all sessions across users (admin only)
 * GET /api/security/sessions/all
 */
router.get(
  '/sessions/all',
  authenticateSupabase,
  authorizeSupabase(UserRole.ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;
      const { page = 1, limit = 50, userId, isActive } = req.query;

      // Super admins can see all, others can only see their organization
      const organizationId =
        user.role === 'SUPER_ADMIN'
          ? (req.query.organizationId as string)
          : user.organizationId;

      const result = await sessionManagementService.getAllSessions({
        organizationId,
        userId: userId as string,
        isActive:
          isActive === 'true' ? true : isActive === 'false' ? false : undefined,
        page: Number(page),
        limit: Number(limit),
      });

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({ success: true, data: result.data });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Get session statistics (admin only)
 * GET /api/security/sessions/stats
 */
router.get(
  '/sessions/stats',
  authenticateSupabase,
  authorizeSupabase(UserRole.ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;

      // Super admins can see all, others can only see their organization
      const organizationId =
        user.role === 'SUPER_ADMIN'
          ? (req.query.organizationId as string)
          : user.organizationId;

      const result =
        await sessionManagementService.getSessionStats(organizationId);

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({ success: true, data: result.data });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Get user sessions
 * GET /api/security/sessions
 */
router.get(
  '/sessions',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;
      const result = await sessionManagementService.getUserSessions(user.id);

      res.json({ success: true, data: result.data });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Get current session status (for polling fallback)
 * GET /api/security/sessions/current
 */
router.get(
  '/sessions/current',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const sessionId = (req as any).sessionId;

      if (!sessionId) {
        return res.status(404).json({
          success: false,
          error: { message: 'No session found' },
        });
      }

      // Get session directly from database
      const { data: session, error } = await supabaseAdmin
        .from('user_sessions')
        .select('id, isActive, lastActivityAt, expiresAt')
        .eq('id', sessionId)
        .single();

      if (error || !session) {
        return res.status(404).json({
          success: false,
          error: { message: 'Session not found' },
        });
      }

      // Check if session is expired
      const isExpired = new Date(session.expiresAt) < new Date();

      res.json({
        success: true,
        data: {
          id: session.id,
          isActive: session.isActive && !isExpired,
          lastActivityAt: session.lastActivityAt,
          expiresAt: session.expiresAt,
        },
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Terminate a specific session
 * DELETE /api/security/sessions/:sessionId
 */
router.delete(
  '/sessions/:sessionId',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId;
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: { message: 'Session ID is required' },
        });
      }

      const result = await sessionManagementService.terminateSession(sessionId);

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({ success: true, message: 'Session terminated' });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Terminate all other sessions (keep current)
 * POST /api/security/sessions/logout-others
 */
router.post(
  '/sessions/logout-others',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;
      const currentSessionId = req.body.currentSessionId;

      await sessionManagementService.terminateAllSessions(
        user.id,
        currentSessionId
      );

      res.json({ success: true, message: 'All other sessions terminated' });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Terminate all sessions (full logout)
 * POST /api/security/sessions/logout-all
 */
router.post(
  '/sessions/logout-all',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;
      await sessionManagementService.terminateAllSessions(user.id);

      res.json({
        success: true,
        message: 'All sessions terminated. Please log in again.',
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Force logout a user (admin only)
 * POST /api/security/sessions/force-logout/:userId
 */
router.post(
  '/sessions/force-logout/:userId',
  authenticateSupabase,
  authorizeSupabase(UserRole.ADMIN, UserRole.ORG_ADMIN),
  async (req: Request, res: Response) => {
    try {
      const admin = (req as any).user || req.userContext;
      const userId = req.params.userId;
      const { reason } = req.body;

      if (!userId) {
        return res
          .status(400)
          .json({ success: false, error: { message: 'User ID is required' } });
      }

      const result = await sessionManagementService.forceLogoutUser(
        userId,
        admin.id,
        reason
      );

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({
        success: true,
        message: 'User forcefully logged out',
        data: result.data,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Get session configuration
 * GET /api/security/sessions/config
 */
router.get(
  '/sessions/config',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const config = sessionManagementService.getConfig();
      res.json({ success: true, data: { config } });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

// ============================================
// RATE LIMITING ROUTES
// ============================================

/**
 * Get rate limit status
 * GET /api/security/rate-limit/status
 */
router.get(
  '/rate-limit/status',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;
      const key = `user:${user.id}`;
      const status = getRateLimitStatus(key);

      // Get all rate limits for this user across different endpoints
      const allLimits = getAllRateLimits();
      const userLimits = allLimits.filter(
        limit => limit.key.includes(user.id) || limit.key.includes(req.ip || '')
      );

      // Default tier config
      const defaultWindowMs = 60000; // 1 minute
      const defaultLimit = 100;

      res.json({
        success: true,
        data: {
          enabled: true,
          defaultLimit,
          windowMs: defaultWindowMs,
          currentUser: {
            count: status?.count || 0,
            remaining: status?.remaining || defaultLimit,
            resetAt: status?.resetAt?.toISOString(),
          },
          userLimits: userLimits.map(l => ({
            key: l.key,
            count: l.count,
            resetAt: l.resetAt.toISOString(),
          })),
          tier: 'default',
        },
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Get all rate limits (admin only)
 * GET /api/security/rate-limit/all
 */
router.get(
  '/rate-limit/all',
  authenticateSupabase,
  authorizeSupabase(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    try {
      const limits = getAllRateLimits();
      res.json({ success: true, data: { limits, count: limits.length } });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Reset rate limit for a user (admin only)
 * POST /api/security/rate-limit/reset/:userId
 */
router.post(
  '/rate-limit/reset/:userId',
  authenticateSupabase,
  authorizeSupabase(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    try {
      const userId = req.params.userId;
      if (!userId) {
        return res
          .status(400)
          .json({ success: false, error: { message: 'User ID is required' } });
      }

      const key = `user:${userId}`;
      const reset = resetRateLimit(key);

      // Log admin action
      const admin = (req as any).user || req.userContext;
      await supabaseAdmin.from('audit_logs').insert({
        userId: admin.id,
        action: 'RATE_LIMIT_RESET',
        resource: 'users',
        resourceId: userId,
      });

      res.json({
        success: true,
        message: reset ? 'Rate limit reset' : 'No rate limit found for user',
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

// ============================================
// API KEY IP WHITELIST ROUTES
// ============================================

/**
 * Get API key whitelist
 * GET /api/security/api-keys/:apiKeyId/whitelist
 */
router.get(
  '/api-keys/:apiKeyId/whitelist',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const apiKeyId = req.params.apiKeyId;
      if (!apiKeyId) {
        return res.status(400).json({
          success: false,
          error: { message: 'API Key ID is required' },
        });
      }

      const result = await apiKeyIPWhitelistService.getWhitelist(apiKeyId);

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({ success: true, data: result.data });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Add IP to whitelist
 * POST /api/security/api-keys/:apiKeyId/whitelist
 */
router.post(
  '/api-keys/:apiKeyId/whitelist',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const apiKeyId = req.params.apiKeyId;
      if (!apiKeyId) {
        return res.status(400).json({
          success: false,
          error: { message: 'API Key ID is required' },
        });
      }

      const { ipAddress, cidr, description, expiresAt } = req.body;

      if (!ipAddress) {
        return res.status(400).json({
          success: false,
          error: { message: 'IP address is required' },
        });
      }

      const result = await apiKeyIPWhitelistService.addToWhitelist(
        apiKeyId,
        ipAddress,
        {
          cidr,
          description,
          expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        }
      );

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.status(201).json({
        success: true,
        message: 'IP added to whitelist',
        data: result.data,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Remove IP from whitelist
 * DELETE /api/security/api-keys/:apiKeyId/whitelist/:entryId
 */
router.delete(
  '/api-keys/:apiKeyId/whitelist/:entryId',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const apiKeyId = req.params.apiKeyId;
      const entryId = req.params.entryId;

      if (!apiKeyId || !entryId) {
        return res.status(400).json({
          success: false,
          error: { message: 'API Key ID and Entry ID are required' },
        });
      }

      const result = await apiKeyIPWhitelistService.removeFromWhitelist(
        apiKeyId,
        entryId
      );

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({ success: true, message: 'IP removed from whitelist' });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Enable/disable IP whitelisting for an API key
 * PATCH /api/security/api-keys/:apiKeyId/whitelist/toggle
 */
router.patch(
  '/api-keys/:apiKeyId/whitelist/toggle',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const apiKeyId = req.params.apiKeyId;
      if (!apiKeyId) {
        return res.status(400).json({
          success: false,
          error: { message: 'API Key ID is required' },
        });
      }

      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: { message: 'enabled (boolean) is required' },
        });
      }

      const result = await apiKeyIPWhitelistService.toggleIPWhitelist(
        apiKeyId,
        enabled
      );

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({ success: true, message: result.message, data: result.data });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Bulk add IPs to whitelist
 * POST /api/security/api-keys/:apiKeyId/whitelist/bulk
 */
router.post(
  '/api-keys/:apiKeyId/whitelist/bulk',
  authenticateSupabase,
  async (req: Request, res: Response) => {
    try {
      const apiKeyId = req.params.apiKeyId;
      if (!apiKeyId) {
        return res.status(400).json({
          success: false,
          error: { message: 'API Key ID is required' },
        });
      }

      const { ips } = req.body;

      if (!Array.isArray(ips) || ips.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'ips array is required' },
        });
      }

      const result = await apiKeyIPWhitelistService.bulkAddToWhitelist(
        apiKeyId,
        ips
      );

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res
        .status(201)
        .json({ success: true, message: result.message, data: result.data });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Clear all whitelist entries
 * DELETE /api/security/api-keys/:apiKeyId/whitelist
 */
router.delete(
  '/api-keys/:apiKeyId/whitelist',
  authenticateSupabase,
  authorizeSupabase(UserRole.ADMIN, UserRole.ORG_ADMIN),
  async (req: Request, res: Response) => {
    try {
      const apiKeyId = req.params.apiKeyId;
      if (!apiKeyId) {
        return res.status(400).json({
          success: false,
          error: { message: 'API Key ID is required' },
        });
      }

      const result = await apiKeyIPWhitelistService.clearWhitelist(apiKeyId);

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, error: { message: result.message } });
      }

      res.json({ success: true, message: 'Whitelist cleared' });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

// ============================================
// SECURITY AUDIT ROUTES
// ============================================

/**
 * Get security audit logs
 * GET /api/security/audit
 */
router.get(
  '/audit',
  authenticateSupabase,
  authorizeSupabase(UserRole.ADMIN, UserRole.ORG_ADMIN, UserRole.MANAGER),
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user || req.userContext;
      const {
        page = 1,
        limit = 50,
        action,
        userId,
        startDate,
        endDate,
      } = req.query;

      let query = supabaseAdmin
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('createdAt', { ascending: false })
        .range(
          (Number(page) - 1) * Number(limit),
          Number(page) * Number(limit) - 1
        );

      // Filter by organization
      if (user.organizationId) {
        query = query.eq('organizationId', user.organizationId);
      }

      // Apply filters
      if (action) {
        const actions = Array.isArray(action) ? action : [action];
        query = query.in('action', actions as string[]);
      }
      if (userId) query = query.eq('userId', userId);
      if (startDate) query = query.gte('createdAt', startDate);
      if (endDate) query = query.lte('createdAt', endDate);

      const { data, error, count } = await query;

      if (error) {
        return res
          .status(400)
          .json({ success: false, error: { message: error.message } });
      }

      res.json({
        success: true,
        data: {
          logs: data,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: count || 0,
            totalPages: Math.ceil((count || 0) / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

/**
 * Get security events summary
 * GET /api/security/events/summary
 */
router.get(
  '/events/summary',
  authenticateSupabase,
  authorizeSupabase(UserRole.ADMIN, UserRole.ORG_ADMIN),
  async (req: Request, res: Response) => {
    try {
      const { days = 7 } = req.query;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - Number(days));

      // Get security-related events
      const { data: events } = await supabaseAdmin
        .from('audit_logs')
        .select('action, createdAt')
        .in('action', [
          'LOGIN_SUCCESS',
          'LOGIN_FAILED',
          'LOGOUT',
          'PASSWORD_CHANGED',
          'RATE_LIMIT_EXCEEDED',
          'API_KEY_IP_BLOCKED',
          'FORCE_LOGOUT',
          'EMAIL_VERIFIED',
        ])
        .gte('createdAt', startDate.toISOString());

      // Aggregate by action
      const summary: Record<string, number> = {};
      (events || []).forEach(event => {
        summary[event.action] = (summary[event.action] || 0) + 1;
      });

      res.json({
        success: true,
        data: {
          period: `Last ${days} days`,
          summary,
          totalEvents: events?.length || 0,
        },
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, error: { message: error.message } });
    }
  }
);

export default router;
