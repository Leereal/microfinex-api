import { supabase, supabaseAdmin } from '../config/supabase-enhanced';
import { hashPassword } from '../utils/auth';
import { generateApiKey } from '../utils/security';
import { UserRole } from '../types';
import { prisma } from '../config/database';

export interface LoginInput {
  email: string;
  password: string;
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

class AuthService {
  /**
   * Authenticate user with email and password
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const { email, password } = input;

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

    // Get user from database with organization
    console.log('🔍 Looking up user:', email);
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select(
        `
        *,
        organization:organizations(*)
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

    // Update last login
    await supabaseAdmin
      .from('users')
      .update({ lastLoginAt: new Date().toISOString() })
      .eq('id', user.id);

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
          lastLoginAt: user.lastLoginAt,
        },
        token: authData.session?.access_token,
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
  async logout(): Promise<AuthResult> {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return {
        success: false,
        message: 'Logout failed',
        error: error.message,
      };
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
        organization:organizations(*)
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

    // Check if registration number is unique if provided
    if (organization.registrationNumber) {
      const existingReg = await prisma.organization.findFirst({
        where: { registrationNumber: organization.registrationNumber },
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
    const typeMap: Record<string, 'MICROFINANCE' | 'BANK' | 'CREDIT_UNION' | 'COOPERATIVE'> = {
      MICROFINANCE: 'MICROFINANCE',
      BANK: 'BANK',
      CREDIT_UNION: 'CREDIT_UNION',
      COOPERATIVE: 'COOPERATIVE',
      SACCO: 'COOPERATIVE',
      FINTECH: 'MICROFINANCE',
      OTHER: 'MICROFINANCE',
    };
    const mappedType = typeMap[organization.type] || 'MICROFINANCE';
    
    const newOrg = await prisma.organization.create({
      data: {
        name: organization.name,
        type: mappedType,
        email: organization.email,
        phone: organization.phone,
        address: organization.address,
        registrationNumber: organization.registrationNumber,
        licenseNumber: organization.licenseNumber,
        website: organization.website,
        isActive: false, // Pending approval
      },
    });

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
