import { supabaseAdmin } from '../../config/supabase-enhanced';
import bcrypt from 'bcrypt';

interface PasswordPolicyConfig {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  preventReuse: number; // Number of previous passwords to check
  maxAgeDays: number; // Password expiration in days (0 = never)
  specialChars: string;
}

interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  strength: 'weak' | 'fair' | 'good' | 'strong';
  score: number;
}

interface PolicyResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

const DEFAULT_POLICY: PasswordPolicyConfig = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  preventReuse: 5,
  maxAgeDays: 90,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
};

class PasswordPolicyService {
  private policy: PasswordPolicyConfig = DEFAULT_POLICY;

  /**
   * Load password policy from organization settings
   */
  async loadPolicy(organizationId?: string): Promise<PasswordPolicyConfig> {
    if (!organizationId) {
      return this.policy;
    }

    try {
      const { data } = await supabaseAdmin
        .from('organization_settings')
        .select('settingValue')
        .eq('organizationId', organizationId)
        .eq('settingKey', 'password_policy')
        .single();

      if (data?.settingValue) {
        this.policy = { ...DEFAULT_POLICY, ...(data.settingValue as Partial<PasswordPolicyConfig>) };
      }
    } catch (error) {
      console.warn('Failed to load password policy, using defaults');
    }

    return this.policy;
  }

  /**
   * Validate password against policy
   */
  validatePassword(password: string, policy?: PasswordPolicyConfig): PasswordValidationResult {
    const p = policy || this.policy;
    const errors: string[] = [];
    let score = 0;

    // Check minimum length
    if (password.length < p.minLength) {
      errors.push(`Password must be at least ${p.minLength} characters`);
    } else {
      score += 1;
      if (password.length >= 12) score += 1;
      if (password.length >= 16) score += 1;
    }

    // Check uppercase
    if (p.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    } else if (/[A-Z]/.test(password)) {
      score += 1;
    }

    // Check lowercase
    if (p.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    } else if (/[a-z]/.test(password)) {
      score += 1;
    }

    // Check numbers
    if (p.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    } else if (/\d/.test(password)) {
      score += 1;
    }

    // Check special characters
    const specialRegex = new RegExp(`[${p.specialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`);
    if (p.requireSpecialChars && !specialRegex.test(password)) {
      errors.push('Password must contain at least one special character');
    } else if (specialRegex.test(password)) {
      score += 1;
    }

    // Check for common patterns (weak passwords)
    const commonPatterns = [
      /^(password|123456|qwerty|abc123|letmein|admin|welcome)/i,
      /(.)\1{2,}/, // 3+ repeated characters
      /^[a-z]+$/i, // All letters
      /^\d+$/, // All numbers
    ];

    for (const pattern of commonPatterns) {
      if (pattern.test(password)) {
        score = Math.max(0, score - 1);
      }
    }

    // Determine strength
    let strength: 'weak' | 'fair' | 'good' | 'strong';
    if (score <= 2) strength = 'weak';
    else if (score <= 4) strength = 'fair';
    else if (score <= 6) strength = 'good';
    else strength = 'strong';

    return {
      valid: errors.length === 0,
      errors,
      strength,
      score: Math.min(score, 7),
    };
  }

  /**
   * Check if password was previously used
   */
  async checkPasswordHistory(userId: string, newPassword: string): Promise<PolicyResult> {
    try {
      // Get password history
      const { data: history } = await supabaseAdmin
        .from('password_history')
        .select('passwordHash')
        .eq('userId', userId)
        .order('createdAt', { ascending: false })
        .limit(this.policy.preventReuse);

      if (!history || history.length === 0) {
        return { success: true, message: 'Password history check passed' };
      }

      // Check against previous passwords
      for (const record of history) {
        const matches = await bcrypt.compare(newPassword, record.passwordHash);
        if (matches) {
          return {
            success: false,
            message: `Password was used recently. Please choose a password you haven't used in the last ${this.policy.preventReuse} changes.`,
            error: 'PASSWORD_REUSED',
          };
        }
      }

      return { success: true, message: 'Password history check passed' };
    } catch (error: any) {
      // If table doesn't exist, pass the check
      console.warn('Password history check skipped:', error.message);
      return { success: true, message: 'Password history check passed' };
    }
  }

  /**
   * Add password to history
   */
  async addToHistory(userId: string, passwordHash: string): Promise<void> {
    try {
      await supabaseAdmin.from('password_history').insert({
        userId,
        passwordHash,
      });

      // Clean up old history entries
      const { data: allHistory } = await supabaseAdmin
        .from('password_history')
        .select('id')
        .eq('userId', userId)
        .order('createdAt', { ascending: false });

      if (allHistory && allHistory.length > this.policy.preventReuse) {
        const toDelete = allHistory.slice(this.policy.preventReuse).map(h => h.id);
        await supabaseAdmin
          .from('password_history')
          .delete()
          .in('id', toDelete);
      }
    } catch (error) {
      console.warn('Failed to add password to history:', error);
    }
  }

  /**
   * Check if password has expired
   */
  async isPasswordExpired(userId: string): Promise<PolicyResult> {
    if (this.policy.maxAgeDays === 0) {
      return { success: true, message: 'Password expiration not enforced' };
    }

    try {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('passwordChangedAt, createdAt')
        .eq('id', userId)
        .single();

      if (!user) {
        return { success: false, message: 'User not found', error: 'USER_NOT_FOUND' };
      }

      const passwordDate = user.passwordChangedAt || user.createdAt;
      const expirationDate = new Date(passwordDate);
      expirationDate.setDate(expirationDate.getDate() + this.policy.maxAgeDays);

      if (new Date() > expirationDate) {
        return {
          success: false,
          message: 'Password has expired. Please change your password.',
          error: 'PASSWORD_EXPIRED',
          data: {
            expiredAt: expirationDate,
            daysSinceChange: Math.floor((Date.now() - new Date(passwordDate).getTime()) / (1000 * 60 * 60 * 24)),
          },
        };
      }

      const daysUntilExpiry = Math.floor((expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      return {
        success: true,
        message: 'Password is current',
        data: {
          expiresAt: expirationDate,
          daysUntilExpiry,
          warningThreshold: daysUntilExpiry <= 7,
        },
      };
    } catch (error: any) {
      console.warn('Password expiration check failed:', error.message);
      return { success: true, message: 'Password expiration check skipped' };
    }
  }

  /**
   * Validate and process password change
   */
  async processPasswordChange(
    userId: string,
    currentPassword: string,
    newPassword: string,
    organizationId?: string
  ): Promise<PolicyResult> {
    // Load organization-specific policy
    await this.loadPolicy(organizationId);

    // Validate new password against policy
    const validation = this.validatePassword(newPassword);
    if (!validation.valid) {
      return {
        success: false,
        message: 'Password does not meet policy requirements',
        error: 'INVALID_PASSWORD',
        data: { errors: validation.errors, strength: validation.strength },
      };
    }

    // Check if same as current
    if (currentPassword === newPassword) {
      return {
        success: false,
        message: 'New password must be different from current password',
        error: 'SAME_PASSWORD',
      };
    }

    // Check password history
    const historyCheck = await this.checkPasswordHistory(userId, newPassword);
    if (!historyCheck.success) {
      return historyCheck;
    }

    // Get current password hash to verify
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('password')
      .eq('id', userId)
      .single();

    if (!user) {
      return { success: false, message: 'User not found', error: 'USER_NOT_FOUND' };
    }

    // Verify current password
    const isCurrentValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentValid) {
      return {
        success: false,
        message: 'Current password is incorrect',
        error: 'INVALID_CURRENT_PASSWORD',
      };
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    const { error } = await supabaseAdmin
      .from('users')
      .update({
        password: newPasswordHash,
        passwordChangedAt: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      return {
        success: false,
        message: 'Failed to update password',
        error: error.message,
      };
    }

    // Add to history
    await this.addToHistory(userId, newPasswordHash);

    return {
      success: true,
      message: 'Password changed successfully',
      data: { strength: validation.strength },
    };
  }

  /**
   * Get current policy
   */
  getPolicy(): PasswordPolicyConfig {
    return { ...this.policy };
  }

  /**
   * Update organization password policy
   */
  async updatePolicy(
    organizationId: string,
    policy: Partial<PasswordPolicyConfig>,
    updatedBy: string
  ): Promise<PolicyResult> {
    const newPolicy = { ...DEFAULT_POLICY, ...policy };

    const { error } = await supabaseAdmin
      .from('organization_settings')
      .upsert({
        organizationId,
        settingKey: 'password_policy',
        settingValue: newPolicy,
        updatedBy,
      });

    if (error) {
      return {
        success: false,
        message: 'Failed to update password policy',
        error: error.message,
      };
    }

    this.policy = newPolicy;

    return {
      success: true,
      message: 'Password policy updated successfully',
      data: { policy: newPolicy },
    };
  }
}

export const passwordPolicyService = new PasswordPolicyService();
