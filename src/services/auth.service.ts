import { supabase, supabaseAdmin } from '../config/supabase-enhanced';
import { hashPassword } from '../utils/auth';
import { generateApiKey } from '../utils/security';
import { UserRole } from '../types';

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
}

export const authService = new AuthService();
