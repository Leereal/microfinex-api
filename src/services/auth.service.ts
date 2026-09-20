import { supabase, supabaseAdmin } from '../config/supabase-enhanced';
import {
  hashPassword,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/auth';
import { generateApiKey, hashString } from '../utils/security';
import { UserRole, ApiTier, JWTPayload } from '../types';
import { prisma } from '../config/database';
import { config } from '../config';
import { sessionManagementService } from './security/session-management.service';

export interface LoginInput {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
  organizationId?: string;
}

export interface OrganizationRegistrationInput {
  organization: {
    name: string;
    type: string;
    email: string;
    phone?: string;
    address?: string;
    registrationNumber?: string;
    licenseNumber?: string;
    website?: string;
  };
  admin: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    password: string;
  };
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface AuthResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

/**
 * Milliseconds represented by a JWT-style duration string ("30d", "12h").
 * Used to set the stored refresh token's expiry alongside the JWT's own.
 */
function durationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) {
    return 30 * 24 * 60 * 60 * 1000; // 30 days
  }
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit as string] ?? multipliers.d!);
}

class AuthService {
  /**
   * Issue a refresh token and persist its hash.
   *
   * Only the SHA-256 hash is stored: a read of the refresh_tokens table then
   * discloses nothing usable, the same reasoning that applies to passwords.
   */
  private async issueRefreshToken(payload: JWTPayload): Promise<string> {
    const refreshToken = generateRefreshToken(payload);
    const expiresAt = new Date(
      Date.now() + durationToMs(config.jwt.refreshExpiresIn)
    );

    await prisma.refreshToken.create({
      data: {
        token: hashString(refreshToken),
        userId: payload.userId,
        expiresAt,
      },
    });

    return refreshToken;
  }

  /**
   * Exchange a refresh token for a new access token.
   *
   * Tokens are rotated on every use: the presented token is deleted and a new
   * one issued, so a stolen token is usable at most once and only until the
   * legitimate holder next refreshes.
   */
  async refresh(refreshToken: string): Promise<AuthResult> {
    if (!refreshToken) {
      return {
        success: false,
        message: 'Refresh token is required',
        error: 'REFRESH_TOKEN_REQUIRED',
      };
    }

    let payload: JWTPayload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return {
        success: false,
        message: 'Invalid or expired refresh token',
        error: 'INVALID_REFRESH_TOKEN',
      };
    }

    const hashed = hashString(refreshToken);
    const stored = await prisma.refreshToken.findUnique({
      where: { token: hashed },
    });

    // Not on record: either already rotated, revoked at logout, or forged.
    if (!stored || stored.userId !== payload.userId) {
      return {
        success: false,
        message: 'Refresh token is no longer valid',
        error: 'INVALID_REFRESH_TOKEN',
      };
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      return {
        success: false,
        message: 'Refresh token has expired',
        error: 'REFRESH_TOKEN_EXPIRED',
      };
    }

    const user = await prisma.user.findFirst({
      where: { id: payload.userId, isActive: true },
      include: { organization: true },
    });

    if (!user) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      return {
        success: false,
        message: 'User no longer active',
        error: 'USER_INACTIVE',
      };
    }

    // Rebuild the payload from current data so a role or permission change
    // takes effect on refresh rather than persisting for the token's lifetime.
    const nextPayload: JWTPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      organizationId: user.organizationId || undefined,
      permissions: user.permissions || [],
      tier: (user.organization?.apiTier as ApiTier) || ApiTier.BASIC,
    };

    const accessToken = generateToken(nextPayload);

    // Rotate: the presented token dies with this request.
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const nextRefreshToken = await this.issueRefreshToken(nextPayload);

    return {
      success: true,
      message: 'Token refreshed',
      data: {
        token: accessToken,
        refreshToken: nextRefreshToken,
        expiresIn: config.jwt.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      },
    };
  }

  /**
   * Revoke every refresh token held by a user (logout, password change,
   * account disabled).
   */
  async revokeRefreshTokens(userId: string): Promise<number> {
    const { count } = await prisma.refreshToken.deleteMany({
      where: { userId },
    });
    return count;
  }

  /**
   * Delete refresh tokens that are past their expiry. Safe to call routinely.
   */
  async purgeExpiredRefreshTokens(): Promise<number> {
    const { count } = await prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }

  /**
   * Authenticate user with email and password
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const {
      email,
      password,
      ipAddress = 'unknown',
      userAgent = 'unknown',
    } = input;

    // Authenticate with Supabase
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (authError) {
      return {
        success: false,
        message: 'Invalid credentials',
        error: authError.message,
      };
    }

    // Get user from database with organization and branch
    console.log('🔍 Looking up user:', email);
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select(
        `
        *,
        organization:organizations(*),
        branch:branches!users_branchId_fkey(*)
      `
      )
      .eq('email', email)
      .single();

    console.log('🔍 User lookup result:', {
      userFound: !!user,
      userError: userError?.message,
      userActive: user?.isActive,
      userRole: user?.role,
    });

    if (userError || !user || !user.isActive) {
      console.error('Login failed - User lookup error:', {
        userError,
        userFound: !!user,
        userActive: user?.isActive,
        email,
      });
      return {
        success: false,
        message: 'User account not found or inactive',
        error: 'UNAUTHORIZED',
      };
    }

    // Check if non-admin users have a branch assigned (check both legacy branchId and new userBranches)
    const adminRoles = ['SUPER_ADMIN', 'ORG_ADMIN'];

    // Get user branches using Prisma for the new many-to-many relationship
    // Wrapped in try-catch to handle case where UserBranch table doesn't exist yet
    let userBranches: Array<{
      branchId: string;
      isCurrent: boolean;
      isPrimary: boolean;
      branch: {
        id: string;
        name: string;
        code: string | null;
        isActive: boolean;
      };
    }> = [];

    try {
      userBranches = await prisma.userBranch.findMany({
        where: { userId: user.id },
        include: {
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
              isActive: true,
            },
          },
        },
        orderBy: [
          { isPrimary: 'desc' },
          { isCurrent: 'desc' },
          { branch: { name: 'asc' } },
        ],
      });
    } catch (error: any) {
      // UserBranch table may not exist yet if migrations haven't been run
      console.warn(
        'UserBranch query failed, falling back to legacy branch:',
        error.message
      );
      userBranches = [];
    }

    // Check branch assignment for non-admin users
    const hasLegacyBranch = !!user.branchId;
    const hasNewBranches = userBranches.length > 0;

    if (
      !adminRoles.includes(user.role) &&
      !hasLegacyBranch &&
      !hasNewBranches
    ) {
      console.warn('Login blocked - User has no branch assigned:', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });
      return {
        success: false,
        message:
          'Your account has not been assigned to a branch. Please contact your administrator.',
        error: 'NO_BRANCH_ASSIGNED',
      };
    }

    // Determine current branch (from new system or legacy)
    let currentBranch = userBranches.find(ub => ub.isCurrent)?.branch;
    if (!currentBranch && userBranches.length > 0) {
      // Set first branch as current if none is marked
      const firstUserBranch = userBranches[0];
      currentBranch = firstUserBranch?.branch;
      try {
        if (firstUserBranch) {
          await prisma.userBranch.update({
            where: {
              userId_branchId: {
                userId: user.id,
                branchId: firstUserBranch.branchId,
              },
            },
            data: { isCurrent: true },
          });
        }
      } catch (error: any) {
        console.warn('Failed to update current branch:', error.message);
      }
    }
    // Fallback to legacy branch if no userBranches
    if (!currentBranch && user.branch) {
      currentBranch = {
        id: user.branch.id,
        name: user.branch.name,
        code: user.branch.code,
        isActive: user.branch.isActive ?? true,
      };
    }

    // Update last login
    await supabaseAdmin
      .from('users')
      .update({ lastLoginAt: new Date().toISOString() })
      .eq('id', user.id);

    // Generate our own JWT token for API authentication
    const tokenPayload: JWTPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      organizationId: user.organization?.id,
      permissions: user.permissions || [],
      tier: (user.organization?.apiTier as ApiTier) || ApiTier.BASIC,
    };
    const token = generateToken(tokenPayload);

    // Issue a refresh token so the client can obtain a new access token
    // without re-prompting for credentials when the short-lived one expires.
    const refreshToken = await this.issueRefreshToken(tokenPayload);

    // Create session record
    const sessionResult = await sessionManagementService.createSession(
      user.id,
      ipAddress,
      userAgent,
      token
    );

    // Log if session creation failed but don't block login
    if (!sessionResult.success) {
      console.warn('Failed to create session record:', sessionResult.message);
    }

    // Format branches for response
    const formattedBranches = userBranches.map(ub => ({
      branchId: ub.branchId,
      branch: {
        id: ub.branch.id,
        name: ub.branch.name,
        code: ub.branch.code,
      },
      isCurrent: ub.isCurrent,
      isPrimary: ub.isPrimary,
    }));

    return {
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organization: user.organization,
          branchId: user.branchId,
          branch: user.branch,
          // New branch support
          currentBranchId: currentBranch?.id,
          currentBranch: currentBranch
            ? {
                id: currentBranch.id,
                name: currentBranch.name,
                code: currentBranch.code,
              }
            : undefined,
          branches: formattedBranches,
          lastLoginAt: user.lastLoginAt,
        },
        token: token,
        refreshToken,
        expiresIn: config.jwt.expiresIn,
        sessionId: sessionResult.data?.sessionId,
      },
    };
  }

  /**
   * Register a new user
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    const {
      email,
      password,
      firstName,
      lastName,
      role = UserRole.STAFF,
      organizationId,
    } = input;

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return {
        success: false,
        message: 'User already exists',
        error: 'USER_EXISTS',
      };
    }

    // Register with Supabase
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          firstName,
          lastName,
          role,
        },
      },
    });

    if (authError) {
      return {
        success: false,
        message: 'Registration failed',
        error: authError.message,
      };
    }

    // Create user in database
    const { data: user, error: createError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user?.id || '',
        email,
        password: await hashPassword(password),
        firstName: firstName,
        lastName: lastName,
        role: role,
        organizationId: organizationId,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select(
        `
        *,
        organization:organizations(*)
      `
      )
      .single();

    if (createError) {
      throw createError;
    }

    return {
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organizationId: user.organizationId,
        },
      },
    };
  }

  /**
   * Logout user
   */
  async logout(userId?: string, sessionId?: string): Promise<AuthResult> {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return {
        success: false,
        message: 'Logout failed',
        error: error.message,
      };
    }

    // Terminate specific session or all sessions for user
    if (sessionId) {
      await sessionManagementService.terminateSession(sessionId);
    } else if (userId) {
      await sessionManagementService.terminateAllSessions(userId);
    }

    return {
      success: true,
      message: 'Logout successful',
    };
  }

  /**
   * Get current user profile
   */
  async getProfile(userId: string): Promise<AuthResult> {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select(
        `
        *,
        organization:organizations(*),
        branch:branches!users_branchId_fkey(*)
      `
      )
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return {
        success: false,
        message: 'User not found',
        error: 'USER_NOT_FOUND',
      };
    }

    return {
      success: true,
      message: 'User profile retrieved successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organizationId: user.organizationId,
          branchId: user.branchId,
          branch: user.branch,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
    };
  }

  /**
   * Change user password
   */
  async changePassword(input: ChangePasswordInput): Promise<AuthResult> {
    const { newPassword } = input;

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      return {
        success: false,
        message: 'Password change failed',
        error: error.message,
      };
    }

    return {
      success: true,
      message: 'Password changed successfully',
    };
  }

  /**
   * Generate API key for organization
   */
  async generateApiKey(
    userEmail: string,
    organizationId: string
  ): Promise<AuthResult> {
    const apiKey = generateApiKey();

    const { error: apiKeyError } = await supabaseAdmin.from('api_keys').insert({
      name: `API Key for ${userEmail}`,
      key: apiKey,
      organizationId: organizationId,
      isActive: true,
    });

    if (apiKeyError) {
      throw apiKeyError;
    }

    return {
      success: true,
      message: 'API key generated successfully',
      data: {
        apiKey,
      },
    };
  }

  /**
   * Register a new organization with its first admin user
   * Organization is created with isActive=false (pending approval)
   */
  async registerOrganization(
    input: OrganizationRegistrationInput
  ): Promise<AuthResult> {
    const { organization, admin } = input;

    // Check if organization with same name or email exists
    const existingOrg = await prisma.organization.findFirst({
      where: {
        OR: [{ name: organization.name }, { email: organization.email }],
      },
    });

    if (existingOrg) {
      return {
        success: false,
        message:
          existingOrg.name === organization.name
            ? 'Organization with this name already exists'
            : 'Organization with this email already exists',
        error: 'ORG_EXISTS',
      };
    }

    // Check if registration number is unique if provided (handle empty strings)
    const registrationNumber = organization.registrationNumber?.trim() || null;
    if (registrationNumber) {
      const existingReg = await prisma.organization.findFirst({
        where: { registrationNumber },
      });
      if (existingReg) {
        return {
          success: false,
          message: 'Organization with this registration number already exists',
          error: 'ORG_REG_EXISTS',
        };
      }
    }

    // Check if admin user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', admin.email)
      .single();

    if (existingUser) {
      return {
        success: false,
        message: 'User with this email already exists',
        error: 'USER_EXISTS',
      };
    }

    // Register admin with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: admin.email,
      password: admin.password,
      options: {
        data: {
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: UserRole.STAFF, // Will be promoted to ORG_ADMIN upon approval
        },
      },
    });

    if (authError) {
      return {
        success: false,
        message: 'Failed to create user account',
        error: authError.message,
      };
    }

    // Create organization with isActive=false (pending approval)
    // Map organization type to valid enum values
    const typeMap: Record<
      string,
      'MICROFINANCE' | 'BANK' | 'CREDIT_UNION' | 'COOPERATIVE'
    > = {
      MICROFINANCE: 'MICROFINANCE',
      BANK: 'BANK',
      CREDIT_UNION: 'CREDIT_UNION',
      COOPERATIVE: 'COOPERATIVE',
      SACCO: 'COOPERATIVE',
      FINTECH: 'MICROFINANCE',
      OTHER: 'MICROFINANCE',
    };
    const mappedType = typeMap[organization.type] || 'MICROFINANCE';

    let newOrg;
    try {
      newOrg = await prisma.organization.create({
        data: {
          name: organization.name,
          type: mappedType,
          email: organization.email,
          phone: organization.phone,
          address: organization.address,
          registrationNumber, // Use the trimmed value (null if empty)
          licenseNumber: organization.licenseNumber?.trim() || null,
          website: organization.website,
          isActive: false, // Pending approval
        },
      });
    } catch (prismaError: unknown) {
      // Handle Prisma unique constraint violations
      if (
        prismaError &&
        typeof prismaError === 'object' &&
        'code' in prismaError &&
        prismaError.code === 'P2002'
      ) {
        const target = (prismaError as { meta?: { target?: string[] } }).meta
          ?.target;
        if (target?.includes('registrationNumber')) {
          return {
            success: false,
            message:
              'Organization with this registration number already exists',
            error: 'ORG_REG_EXISTS',
          };
        }
        if (target?.includes('name')) {
          return {
            success: false,
            message: 'Organization with this name already exists',
            error: 'ORG_EXISTS',
          };
        }
        if (target?.includes('email')) {
          return {
            success: false,
            message: 'Organization with this email already exists',
            error: 'ORG_EXISTS',
          };
        }
        return {
          success: false,
          message: 'Organization with this information already exists',
          error: 'ORG_EXISTS',
        };
      }
      throw prismaError; // Re-throw other errors
    }

    // Create admin user in database (inactive until org is approved)
    const { data: user, error: createError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user?.id || '',
        email: admin.email,
        password: await hashPassword(admin.password),
        firstName: admin.firstName,
        lastName: admin.lastName,
        phone: admin.phone,
        role: UserRole.STAFF, // Will be promoted upon org approval
        organizationId: newOrg.id,
        isActive: false, // Inactive until org is approved
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) {
      // Rollback: delete the organization
      await prisma.organization.delete({ where: { id: newOrg.id } });
      throw createError;
    }

    return {
      success: true,
      message:
        'Organization registration submitted successfully. Your account is pending approval.',
      data: {
        organization: {
          id: newOrg.id,
          name: newOrg.name,
          email: newOrg.email,
          status: 'PENDING_APPROVAL',
        },
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      },
    };
  }

  /**
   * Approve an organization and promote its first user to ORG_ADMIN
   * Only SUPER_ADMIN can perform this action
   */
  async approveOrganization(organizationId: string): Promise<AuthResult> {
    // Get organization
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      return {
        success: false,
        message: 'Organization not found',
        error: 'ORG_NOT_FOUND',
      };
    }

    if (org.isActive) {
      return {
        success: false,
        message: 'Organization is already active',
        error: 'ORG_ALREADY_ACTIVE',
      };
    }

    // Get the first user (admin) of the organization
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('organizationId', organizationId)
      .order('createdAt', { ascending: true })
      .limit(1);

    if (!users || users.length === 0) {
      return {
        success: false,
        message: 'No users found for this organization',
        error: 'NO_USERS',
      };
    }

    const adminUser = users[0];

    // Activate organization
    await prisma.organization.update({
      where: { id: organizationId },
      data: { isActive: true },
    });

    // Promote first user to ORG_ADMIN and activate
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        role: UserRole.ORG_ADMIN,
        isActive: true,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', adminUser.id);

    if (updateError) {
      // Rollback organization activation
      await prisma.organization.update({
        where: { id: organizationId },
        data: { isActive: false },
      });
      throw updateError;
    }

    return {
      success: true,
      message: 'Organization approved successfully',
      data: {
        organization: {
          id: org.id,
          name: org.name,
          email: org.email,
          isActive: true,
        },
        admin: {
          id: adminUser.id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          role: UserRole.ORG_ADMIN,
        },
      },
    };
  }

  /**
   * Reject an organization registration
   * Only SUPER_ADMIN can perform this action
   */
  async rejectOrganization(
    organizationId: string,
    reason?: string
  ): Promise<AuthResult> {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      return {
        success: false,
        message: 'Organization not found',
        error: 'ORG_NOT_FOUND',
      };
    }

    if (org.isActive) {
      return {
        success: false,
        message: 'Cannot reject an active organization',
        error: 'ORG_ALREADY_ACTIVE',
      };
    }

    // Get users associated with the organization
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('organizationId', organizationId);

    // Delete users from Supabase Auth and database
    if (users && users.length > 0) {
      for (const user of users) {
        // Delete from Supabase Auth
        await supabaseAdmin.auth.admin.deleteUser(user.id);
        // Delete from users table
        await supabaseAdmin.from('users').delete().eq('id', user.id);
      }
    }

    // Delete organization
    await prisma.organization.delete({
      where: { id: organizationId },
    });

    return {
      success: true,
      message: 'Organization registration rejected',
      data: {
        organizationId,
        reason: reason || 'Registration rejected by administrator',
      },
    };
  }

  /**
   * Get all pending organizations (for SUPER_ADMIN)
   */
  async getPendingOrganizations(): Promise<AuthResult> {
    const organizations = await prisma.organization.findMany({
      where: { isActive: false },
      include: {
        _count: {
          select: { users: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get first user for each organization
    const orgsWithAdmins = await Promise.all(
      organizations.map(async org => {
        const { data: users } = await supabaseAdmin
          .from('users')
          .select('id, email, firstName, lastName, createdAt')
          .eq('organizationId', org.id)
          .order('createdAt', { ascending: true })
          .limit(1);

        return {
          ...org,
          pendingAdmin: users?.[0] || null,
        };
      })
    );

    return {
      success: true,
      message: 'Pending organizations retrieved successfully',
      data: {
        organizations: orgsWithAdmins,
        total: orgsWithAdmins.length,
      },
    };
  }
}

export const authService = new AuthService();
