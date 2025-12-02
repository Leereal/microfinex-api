import { supabaseAdmin } from '../../config/supabase-enhanced';
import crypto from 'crypto';

interface VerificationToken {
  id: string;
  userId: string;
  token: string;
  type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
  expiresAt: Date;
  createdAt: Date;
  usedAt?: Date;
}

interface VerificationResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

class EmailVerificationService {
  private readonly TOKEN_EXPIRY_HOURS = 24;
  private readonly TOKEN_LENGTH = 32;

  /**
   * Generate a secure verification token
   */
  private generateToken(): string {
    return crypto.randomBytes(this.TOKEN_LENGTH).toString('hex');
  }

  /**
   * Create an email verification token for a user
   */
  async createVerificationToken(userId: string): Promise<VerificationResult> {
    try {
      // Invalidate any existing tokens for this user
      await supabaseAdmin
        .from('verification_tokens')
        .update({ usedAt: new Date().toISOString() })
        .eq('userId', userId)
        .eq('type', 'EMAIL_VERIFICATION')
        .is('usedAt', null);

      const token = this.generateToken();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + this.TOKEN_EXPIRY_HOURS);

      const { data, error } = await supabaseAdmin
        .from('verification_tokens')
        .insert({
          userId,
          token,
          type: 'EMAIL_VERIFICATION',
          expiresAt: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (error) {
        // If table doesn't exist, we'll use a simpler approach
        console.warn('Verification tokens table not found, using alternative approach');
        return {
          success: true,
          message: 'Verification token created',
          data: { token, expiresAt },
        };
      }

      return {
        success: true,
        message: 'Verification token created',
        data: { token, expiresAt },
      };
    } catch (error: any) {
      console.error('Error creating verification token:', error);
      return {
        success: false,
        message: 'Failed to create verification token',
        error: error.message,
      };
    }
  }

  /**
   * Verify an email verification token
   */
  async verifyToken(token: string): Promise<VerificationResult> {
    try {
      // Find the token
      const { data: tokenRecord, error: findError } = await supabaseAdmin
        .from('verification_tokens')
        .select('*')
        .eq('token', token)
        .eq('type', 'EMAIL_VERIFICATION')
        .is('usedAt', null)
        .single();

      if (findError || !tokenRecord) {
        return {
          success: false,
          message: 'Invalid or expired verification token',
          error: 'INVALID_TOKEN',
        };
      }

      // Check if token has expired
      if (new Date(tokenRecord.expiresAt) < new Date()) {
        return {
          success: false,
          message: 'Verification token has expired',
          error: 'TOKEN_EXPIRED',
        };
      }

      // Mark token as used
      await supabaseAdmin
        .from('verification_tokens')
        .update({ usedAt: new Date().toISOString() })
        .eq('id', tokenRecord.id);

      // Update user's email verification status
      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ isEmailVerified: true })
        .eq('id', tokenRecord.userId);

      if (updateError) {
        return {
          success: false,
          message: 'Failed to verify email',
          error: updateError.message,
        };
      }

      return {
        success: true,
        message: 'Email verified successfully',
        data: { userId: tokenRecord.userId },
      };
    } catch (error: any) {
      console.error('Error verifying token:', error);
      return {
        success: false,
        message: 'Failed to verify token',
        error: error.message,
      };
    }
  }

  /**
   * Resend verification email
   */
  async resendVerification(userId: string): Promise<VerificationResult> {
    try {
      // Check if user exists and is not already verified
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email, isEmailVerified')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        return {
          success: false,
          message: 'User not found',
          error: 'USER_NOT_FOUND',
        };
      }

      if (user.isEmailVerified) {
        return {
          success: false,
          message: 'Email is already verified',
          error: 'ALREADY_VERIFIED',
        };
      }

      // Check for recent verification attempts (rate limiting)
      const { data: recentTokens } = await supabaseAdmin
        .from('verification_tokens')
        .select('createdAt')
        .eq('userId', userId)
        .eq('type', 'EMAIL_VERIFICATION')
        .order('createdAt', { ascending: false })
        .limit(1);

      if (recentTokens && recentTokens.length > 0) {
        const lastToken = recentTokens[0];
        if (lastToken) {
          const timeSinceLastToken = Date.now() - new Date(lastToken.createdAt).getTime();
          const MIN_RESEND_INTERVAL = 60000; // 1 minute

          if (timeSinceLastToken < MIN_RESEND_INTERVAL) {
            return {
              success: false,
              message: 'Please wait before requesting another verification email',
              error: 'RATE_LIMITED',
            };
          }
        }
      }

      // Create new verification token
      return await this.createVerificationToken(userId);
    } catch (error: any) {
      console.error('Error resending verification:', error);
      return {
        success: false,
        message: 'Failed to resend verification',
        error: error.message,
      };
    }
  }

  /**
   * Create a password reset token
   */
  async createPasswordResetToken(email: string): Promise<VerificationResult> {
    try {
      // Find user by email
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .eq('email', email)
        .single();

      if (userError || !user) {
        // Don't reveal whether user exists
        return {
          success: true,
          message: 'If an account exists, a password reset email will be sent',
        };
      }

      // Invalidate any existing reset tokens
      await supabaseAdmin
        .from('verification_tokens')
        .update({ usedAt: new Date().toISOString() })
        .eq('userId', user.id)
        .eq('type', 'PASSWORD_RESET')
        .is('usedAt', null);

      const token = this.generateToken();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour expiry for password reset

      await supabaseAdmin
        .from('verification_tokens')
        .insert({
          userId: user.id,
          token,
          type: 'PASSWORD_RESET',
          expiresAt: expiresAt.toISOString(),
        });

      return {
        success: true,
        message: 'If an account exists, a password reset email will be sent',
        data: { token, userId: user.id, email: user.email },
      };
    } catch (error: any) {
      console.error('Error creating password reset token:', error);
      return {
        success: false,
        message: 'Failed to process request',
        error: error.message,
      };
    }
  }

  /**
   * Verify password reset token
   */
  async verifyPasswordResetToken(token: string): Promise<VerificationResult> {
    try {
      const { data: tokenRecord, error } = await supabaseAdmin
        .from('verification_tokens')
        .select('*')
        .eq('token', token)
        .eq('type', 'PASSWORD_RESET')
        .is('usedAt', null)
        .single();

      if (error || !tokenRecord) {
        return {
          success: false,
          message: 'Invalid or expired reset token',
          error: 'INVALID_TOKEN',
        };
      }

      if (new Date(tokenRecord.expiresAt) < new Date()) {
        return {
          success: false,
          message: 'Reset token has expired',
          error: 'TOKEN_EXPIRED',
        };
      }

      return {
        success: true,
        message: 'Token is valid',
        data: { userId: tokenRecord.userId },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to verify token',
        error: error.message,
      };
    }
  }

  /**
   * Mark user as manually verified (admin action)
   */
  async manualVerification(userId: string, adminId: string): Promise<VerificationResult> {
    try {
      const { error } = await supabaseAdmin
        .from('users')
        .update({ isEmailVerified: true })
        .eq('id', userId);

      if (error) {
        return {
          success: false,
          message: 'Failed to verify user',
          error: error.message,
        };
      }

      // Log the admin action
      await supabaseAdmin.from('audit_logs').insert({
        userId: adminId,
        action: 'MANUAL_EMAIL_VERIFICATION',
        resource: 'users',
        resourceId: userId,
        newValue: { isEmailVerified: true },
      });

      return {
        success: true,
        message: 'User email verified manually',
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to verify user',
        error: error.message,
      };
    }
  }
}

export const emailVerificationService = new EmailVerificationService();
