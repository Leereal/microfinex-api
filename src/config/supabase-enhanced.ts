import { createClient } from '@supabase/supabase-js';
import { config } from './index';

// Standard Supabase client for client-side operations (with RLS)
export const supabase = createClient(
  config.supabase.url,
  config.supabase.anonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
  }
);

// Admin client for server-side operations (bypasses RLS)
export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Database-only client for direct queries (useful for complex operations)
export const supabaseDb = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public', // Use public schema for our tables
    },
  }
);

/**
 * Helper function to get user context from JWT token
 */
export const getUserFromToken = async (token: string) => {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error) throw error;
    return user;
  } catch (error) {
    console.error('Error getting user from token:', error);
    return null;
  }
};

/**
 * Helper function to verify and get user with organization context
 */
export const getUserWithContext = async (token: string) => {
  try {
    const user = await getUserFromToken(token);
    if (!user) return null;

    // Get user with organization details from our custom table
    const { data: userData, error } = await supabaseAdmin
      .from('users')
      .select(
        `
        *,
        organization:organizations(*)
      `
      )
      .eq('id', user.id)
      .single();

    if (error) throw error;

    return {
      supabaseUser: user,
      appUser: userData,
    };
  } catch (error) {
    console.error('Error getting user context:', error);
    return null;
  }
};

/**
 * Helper function to check if user has required role
 */
export const hasRole = (userRole: string, requiredRoles: string[]): boolean => {
  return requiredRoles.includes(userRole);
};

/**
 * Helper function to get organization-scoped query builder
 */
export const getOrgScopedQuery = (
  tableName: string,
  organizationId: string
) => {
  return supabaseAdmin
    .from(tableName)
    .select('*')
    .eq('organizationId', organizationId);
};

export default supabase;
