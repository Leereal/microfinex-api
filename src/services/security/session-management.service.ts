import { supabaseAdmin } from '../../config/supabase-enhanced';
import crypto from 'crypto';

interface Session {
  id: string;
  userId: string;
  token: string;
  deviceInfo: DeviceInfo;
  ipAddress: string;
  userAgent: string;
  isActive: boolean;
  lastActivityAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

interface DeviceInfo {
  type: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  os?: string;
  browser?: string;
  deviceId?: string;
}

interface SessionResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

interface SessionConfig {
  maxConcurrentSessions: number;
  sessionTimeoutMinutes: number;
  idleTimeoutMinutes: number;
  requireDeviceTracking: boolean;
}

const DEFAULT_CONFIG: SessionConfig = {
  maxConcurrentSessions: 5,
  sessionTimeoutMinutes: 480, // 8 hours
  idleTimeoutMinutes: 30,
  requireDeviceTracking: true,
};

class SessionManagementService {
  private config: SessionConfig = DEFAULT_CONFIG;

  /**
   * Parse user agent string to extract device info
   */
  parseUserAgent(userAgent: string): DeviceInfo {
    const ua = userAgent.toLowerCase();

    let type: DeviceInfo['type'] = 'unknown';
    if (/mobile|android|iphone|ipad|ipod|blackberry|windows phone/i.test(ua)) {
      type = /tablet|ipad/i.test(ua) ? 'tablet' : 'mobile';
    } else if (/windows|macintosh|linux/i.test(ua)) {
      type = 'desktop';
    }

    let os = 'Unknown';
    if (/windows/i.test(ua)) os = 'Windows';
    else if (/macintosh|mac os/i.test(ua)) os = 'macOS';
    else if (/linux/i.test(ua)) os = 'Linux';
    else if (/android/i.test(ua)) os = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';

    let browser = 'Unknown';
    if (/chrome/i.test(ua) && !/edge|edg/i.test(ua)) browser = 'Chrome';
    else if (/firefox/i.test(ua)) browser = 'Firefox';
    else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
    else if (/edge|edg/i.test(ua)) browser = 'Edge';
    else if (/opera|opr/i.test(ua)) browser = 'Opera';

    return { type, os, browser };
  }

  /**
   * Generate a unique device ID
   */
  generateDeviceId(userAgent: string, ipAddress: string): string {
    const data = `${userAgent}:${ipAddress}`;
    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Create a new session
   */
  async createSession(
    userId: string,
    ipAddress: string,
    userAgent: string,
    token: string
  ): Promise<SessionResult> {
    try {
      const deviceInfo = this.parseUserAgent(userAgent);
      deviceInfo.deviceId = this.generateDeviceId(userAgent, ipAddress);

      // Check concurrent session limit
      const { data: activeSessions } = await supabaseAdmin
        .from('user_sessions')
        .select('id, createdAt')
        .eq('userId', userId)
        .eq('isActive', true)
        .order('createdAt', { ascending: true });

      if (
        activeSessions &&
        activeSessions.length >= this.config.maxConcurrentSessions
      ) {
        // Terminate oldest session
        const oldestSession = activeSessions[0];
        if (oldestSession) {
          await this.terminateSession(oldestSession.id);
        }
      }

      const expiresAt = new Date();
      expiresAt.setMinutes(
        expiresAt.getMinutes() + this.config.sessionTimeoutMinutes
      );

      // Generate UUID for the session id
      const sessionId = crypto.randomUUID();

      const insertData = {
        id: sessionId,
        userId,
        token: crypto.createHash('sha256').update(token).digest('hex'),
        deviceInfo,
        ipAddress,
        userAgent,
        isActive: true,
        lastActivityAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      console.log('Creating session with ID:', sessionId);

      const { data, error } = await supabaseAdmin
        .from('user_sessions')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('Session creation error:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        return {
          success: false,
          message: 'Failed to create session',
          error: error.message,
        };
      }

      console.log('Session created successfully:', data?.id);
      return {
        success: true,
        message: 'Session created successfully',
        data: {
          sessionId: data.id,
          deviceInfo,
          expiresAt,
        },
      };
    } catch (error: any) {
      console.error('Error creating session:', error);
      return {
        success: false,
        message: 'Failed to create session',
        error: error.message,
      };
    }
  }

  /**
   * Update session activity
   */
  async updateActivity(sessionId: string): Promise<SessionResult> {
    try {
      const now = new Date();

      const { data: session, error: fetchError } = await supabaseAdmin
        .from('user_sessions')
        .select('lastActivityAt, expiresAt, isActive')
        .eq('id', sessionId)
        .single();

      if (fetchError || !session) {
        return {
          success: false,
          message: 'Session not found',
          error: 'SESSION_NOT_FOUND',
        };
      }

      if (!session.isActive) {
        return {
          success: false,
          message: 'Session is inactive',
          error: 'SESSION_INACTIVE',
        };
      }

      // Check if session has expired
      if (new Date(session.expiresAt) < now) {
        await this.terminateSession(sessionId);
        return {
          success: false,
          message: 'Session has expired',
          error: 'SESSION_EXPIRED',
        };
      }

      // Check idle timeout
      const lastActivity = new Date(session.lastActivityAt);
      const idleTime = (now.getTime() - lastActivity.getTime()) / (1000 * 60);

      if (idleTime > this.config.idleTimeoutMinutes) {
        await this.terminateSession(sessionId);
        return {
          success: false,
          message: 'Session timed out due to inactivity',
          error: 'SESSION_IDLE_TIMEOUT',
        };
      }

      // Update last activity
      await supabaseAdmin
        .from('user_sessions')
        .update({ lastActivityAt: now.toISOString() })
        .eq('id', sessionId);

      return {
        success: true,
        message: 'Session activity updated',
        data: { lastActivityAt: now },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to update session activity',
        error: error.message,
      };
    }
  }

  /**
   * Terminate a specific session
   */
  async terminateSession(sessionId: string): Promise<SessionResult> {
    try {
      const { error } = await supabaseAdmin
        .from('user_sessions')
        .update({ isActive: false })
        .eq('id', sessionId);

      if (error) {
        return {
          success: false,
          message: 'Failed to terminate session',
          error: error.message,
        };
      }

      return {
        success: true,
        message: 'Session terminated successfully',
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to terminate session',
        error: error.message,
      };
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<SessionResult> {
    try {
      const { data: sessions, error } = await supabaseAdmin
        .from('user_sessions')
        .select(
          'id, deviceInfo, ipAddress, lastActivityAt, createdAt, expiresAt'
        )
        .eq('userId', userId)
        .eq('isActive', true)
        .order('lastActivityAt', { ascending: false });

      if (error) {
        // Fallback to refresh_tokens
        const { data: tokens } = await supabaseAdmin
          .from('refresh_tokens')
          .select('id, createdAt, expiresAt')
          .eq('userId', userId);

        return {
          success: true,
          message: 'Sessions retrieved',
          data: {
            sessions: tokens || [],
            count: tokens?.length || 0,
          },
        };
      }

      return {
        success: true,
        message: 'Sessions retrieved successfully',
        data: {
          sessions,
          count: sessions?.length || 0,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to get sessions',
        error: error.message,
      };
    }
  }

  /**
   * Terminate all sessions for a user
   */
  async terminateAllSessions(
    userId: string,
    exceptSessionId?: string
  ): Promise<SessionResult> {
    try {
      let query = supabaseAdmin
        .from('user_sessions')
        .update({ isActive: false })
        .eq('userId', userId);

      if (exceptSessionId) {
        query = query.neq('id', exceptSessionId);
      }

      const { error } = await query;

      if (error) {
        // Fallback to refresh_tokens
        let tokenQuery = supabaseAdmin
          .from('refresh_tokens')
          .delete()
          .eq('userId', userId);

        if (exceptSessionId) {
          tokenQuery = tokenQuery.neq('id', exceptSessionId);
        }

        await tokenQuery;
      }

      return {
        success: true,
        message: 'All sessions terminated',
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to terminate sessions',
        error: error.message,
      };
    }
  }

  /**
   * Force logout from all devices (admin action)
   */
  async forceLogoutUser(
    userId: string,
    adminId: string,
    reason?: string
  ): Promise<SessionResult> {
    try {
      await this.terminateAllSessions(userId);

      // Log the admin action
      await supabaseAdmin.from('audit_logs').insert({
        userId: adminId,
        action: 'FORCE_LOGOUT',
        resource: 'users',
        resourceId: userId,
        newValue: { reason, forcedAt: new Date().toISOString() },
      });

      return {
        success: true,
        message: 'User forcefully logged out from all devices',
        data: { userId, reason },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to force logout user',
        error: error.message,
      };
    }
  }

  /**
   * Validate session
   */
  async validateSession(token: string): Promise<SessionResult> {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const { data: session, error } = await supabaseAdmin
        .from('user_sessions')
        .select('*')
        .eq('token', tokenHash)
        .eq('isActive', true)
        .single();

      if (error || !session) {
        return {
          success: false,
          message: 'Invalid session',
          error: 'INVALID_SESSION',
        };
      }

      // Check expiration
      if (new Date(session.expiresAt) < new Date()) {
        await this.terminateSession(session.id);
        return {
          success: false,
          message: 'Session expired',
          error: 'SESSION_EXPIRED',
        };
      }

      return {
        success: true,
        message: 'Session is valid',
        data: {
          sessionId: session.id,
          userId: session.userId,
          deviceInfo: session.deviceInfo,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Session validation failed',
        error: error.message,
      };
    }
  }

  /**
   * Get session configuration
   */
  getConfig(): SessionConfig {
    return { ...this.config };
  }

  /**
   * Update session configuration
   */
  async updateConfig(
    organizationId: string,
    config: Partial<SessionConfig>,
    updatedBy: string
  ): Promise<SessionResult> {
    const newConfig = { ...this.config, ...config };

    const { error } = await supabaseAdmin.from('organization_settings').upsert({
      organizationId,
      settingKey: 'session_config',
      settingValue: newConfig,
      updatedBy,
    });

    if (error) {
      return {
        success: false,
        message: 'Failed to update session configuration',
        error: error.message,
      };
    }

    this.config = newConfig;

    return {
      success: true,
      message: 'Session configuration updated',
      data: { config: newConfig },
    };
  }

  /**
   * Cleanup expired sessions (to be run periodically)
   */
  async cleanupExpiredSessions(): Promise<SessionResult> {
    try {
      const { data, error } = await supabaseAdmin
        .from('user_sessions')
        .update({ isActive: false })
        .lt('expiresAt', new Date().toISOString())
        .eq('isActive', true)
        .select('id');

      if (error) {
        return {
          success: false,
          message: 'Cleanup failed',
          error: error.message,
        };
      }

      return {
        success: true,
        message: 'Expired sessions cleaned up',
        data: { terminatedCount: data?.length || 0 },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Cleanup failed',
        error: error.message,
      };
    }
  }

  /**
   * Get all sessions across all users (admin function)
   * Supports filtering by organization, user, and status
   */
  async getAllSessions(params: {
    organizationId?: string;
    userId?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<SessionResult> {
    try {
      const {
        organizationId,
        userId,
        isActive = true,
        page = 1,
        limit = 50,
      } = params;
      const offset = (page - 1) * limit;

      // First, fetch sessions without join
      let query = supabaseAdmin
        .from('user_sessions')
        .select('*', { count: 'exact' });

      // Apply filters
      if (isActive !== undefined) {
        query = query.eq('isActive', isActive);
      }

      if (userId) {
        query = query.eq('userId', userId);
      }

      // Apply pagination and ordering
      query = query
        .order('lastActivityAt', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: sessions, error, count } = await query;

      if (error) {
        console.error('Error fetching sessions:', error);
        return {
          success: false,
          message: 'Failed to fetch sessions',
          error: error.message,
        };
      }

      // Get unique user IDs from sessions
      const userIds = [...new Set((sessions || []).map((s: any) => s.userId))];

      // Fetch user details for these sessions
      let usersMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: users } = await supabaseAdmin
          .from('users')
          .select('id, email, firstName, lastName, organizationId')
          .in('id', userIds);

        if (users) {
          usersMap = users.reduce((acc: Record<string, any>, user: any) => {
            acc[user.id] = user;
            return acc;
          }, {});
        }
      }

      // Transform sessions to include user info
      let transformedSessions = (sessions || []).map((session: any) => {
        const user = usersMap[session.userId];
        return {
          id: session.id,
          userId: session.userId,
          user: user
            ? {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                organizationId: user.organizationId,
              }
            : null,
          deviceInfo: session.deviceInfo,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          isActive: session.isActive,
          lastActivityAt: session.lastActivityAt,
          expiresAt: session.expiresAt,
          createdAt: session.createdAt,
        };
      });

      // Filter by organization if specified (post-fetch filtering since we can't join)
      if (organizationId) {
        transformedSessions = transformedSessions.filter(
          (session: any) => session.user?.organizationId === organizationId
        );
      }

      return {
        success: true,
        message: 'All sessions retrieved successfully',
        data: {
          sessions: transformedSessions,
          pagination: {
            page,
            limit,
            total: count || 0,
            totalPages: Math.ceil((count || 0) / limit),
          },
        },
      };
    } catch (error: any) {
      console.error('Error in getAllSessions:', error);
      return {
        success: false,
        message: 'Failed to retrieve sessions',
        error: error.message,
      };
    }
  }

  /**
   * Get session statistics (admin function)
   */
  async getSessionStats(organizationId?: string): Promise<SessionResult> {
    try {
      // Get active sessions count
      let activeQuery = supabaseAdmin
        .from('user_sessions')
        .select('id', { count: 'exact' })
        .eq('isActive', true);

      // Get total sessions count
      let totalQuery = supabaseAdmin
        .from('user_sessions')
        .select('id', { count: 'exact' });

      // If organization filter is provided, we need to join with users
      // For now, get overall stats
      const [activeResult, totalResult] = await Promise.all([
        activeQuery,
        totalQuery,
      ]);

      // Get sessions created in last 24 hours
      const last24Hours = new Date();
      last24Hours.setHours(last24Hours.getHours() - 24);

      const { count: newSessionsCount } = await supabaseAdmin
        .from('user_sessions')
        .select('id', { count: 'exact' })
        .gte('createdAt', last24Hours.toISOString());

      // Get unique users with active sessions
      const { data: uniqueUsers } = await supabaseAdmin
        .from('user_sessions')
        .select('userId')
        .eq('isActive', true);

      const uniqueUserCount = new Set(uniqueUsers?.map(s => s.userId) || [])
        .size;

      return {
        success: true,
        message: 'Session statistics retrieved',
        data: {
          activeSessions: activeResult.count || 0,
          totalSessions: totalResult.count || 0,
          newSessionsLast24h: newSessionsCount || 0,
          uniqueActiveUsers: uniqueUserCount,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to get session statistics',
        error: error.message,
      };
    }
  }

  /**
   * Validate a session by token hash and update activity
   * Used by auth middleware to validate active sessions
   */
  async validateSessionByToken(token: string): Promise<SessionResult> {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const { data: session, error } = await supabaseAdmin
        .from('user_sessions')
        .select('id, userId, isActive, expiresAt, lastActivityAt')
        .eq('token', tokenHash)
        .single();

      if (error || !session) {
        return {
          success: false,
          message: 'Session not found',
          error: 'SESSION_NOT_FOUND',
        };
      }

      // Check if session is active
      if (!session.isActive) {
        return {
          success: false,
          message: 'Session has been terminated',
          error: 'SESSION_TERMINATED',
        };
      }

      // Check if session has expired
      if (new Date(session.expiresAt) < new Date()) {
        // Mark session as inactive
        await supabaseAdmin
          .from('user_sessions')
          .update({ isActive: false })
          .eq('id', session.id);

        return {
          success: false,
          message: 'Session has expired',
          error: 'SESSION_EXPIRED',
        };
      }

      // Update last activity
      await supabaseAdmin
        .from('user_sessions')
        .update({ lastActivityAt: new Date().toISOString() })
        .eq('id', session.id);

      return {
        success: true,
        message: 'Session is valid',
        data: {
          sessionId: session.id,
          userId: session.userId,
        },
      };
    } catch (error: any) {
      console.error('Error validating session:', error);
      return {
        success: false,
        message: 'Failed to validate session',
        error: error.message,
      };
    }
  }

  /**
   * Get session by token (for identifying current session)
   */
  async getSessionByToken(token: string): Promise<SessionResult> {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const { data: session, error } = await supabaseAdmin
        .from('user_sessions')
        .select('*')
        .eq('token', tokenHash)
        .single();

      if (error || !session) {
        return {
          success: false,
          message: 'Session not found',
          error: 'SESSION_NOT_FOUND',
        };
      }

      return {
        success: true,
        message: 'Session found',
        data: session,
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to get session',
        error: error.message,
      };
    }
  }
}

export const sessionManagementService = new SessionManagementService();
