/**
 * Auth Middleware Re-exports
 * Provides a consistent import path for authentication middleware
 */

import { Request, Response, NextFunction } from 'express';
import { authenticate, requirePermission, authorize, requireOrganization, authenticateApiKey } from './auth';

// Re-export authenticate as authenticateToken for backward compatibility
export const authenticateToken = authenticate;

// Re-export other auth functions
export { requirePermission, authorize, requireOrganization, authenticateApiKey };
