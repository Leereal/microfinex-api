import { Router } from 'express';
import {
  getVersionPrefix,
  getVersionInfo,
  CURRENT_VERSION,
} from '../utils/version';
import authRoutes from './auth.routes';
import organizationRoutes from './organizations.routes';
import userRoutes from './users.routes';
import clientRoutes from './clients.routes';
import loanRoutes from './loans.routes';
import loanDemoRoutes from './loan-demo.routes';
import paymentRoutes from './payments.routes';
import groupRoutes from './groups.routes';
import employerRoutes from './employers.routes';
import reportRoutes from './reports.routes';
import settingsRoutes from './settings.routes';
import exchangeRateRoutes from './exchange-rates.routes';
import loanCategoryRoutes from './loan-categories.routes';
import loanProductRoutes from './loan-products.routes';
import loanWorkflowRoutes from './loan-workflow.routes';
import shopRoutes from './shops.routes';
import loanItemRoutes from './loan-items.routes';
import onlineApplicationRoutes from './online-applications.routes';
import roleRoutes from './roles.routes';
import auditRoutes from './audit.routes';
import publicRoutes from './public.routes';
import uploadRoutes from './uploads.routes';
import syncRoutes from './sync.routes';
// Phase 14-19 routes
import notificationRoutes from './notification.routes';
import importRoutes from './import.routes';
import dashboardRoutes from './dashboard.routes';
import enhancedReportRoutes from './report.routes';
import branchRoutes from './branch.routes';
import userManagementRoutes from './user.routes';
import paymentEnhancementRoutes from './payment-enhancement.routes';
import loanAdjustmentRoutes from './loan-adjustment.routes';
// Phase 20 routes
import securityRoutes from './security.routes';
import encryptionRoutes from './encryption.routes';
// Client Management routes
import documentRoutes from './document.routes';
import collateralRoutes from './collateral.routes';
import aiRoutes from './ai.routes';
import clientDraftRoutes from './client-drafts.routes';
// Currency management
import currencyRoutes from './currency.routes';
// Financial Management routes
import paymentMethodRoutes from './payment-method.routes';
import incomeCategoryRoutes from './income-category.routes';
import expenseCategoryRoutes from './expense-category.routes';
import financialTransactionRoutes from './financial-transaction.routes';
// Notes module
import notesRoutes from './notes.routes';
// Loan configuration
import loanPurposeRoutes from './loan-purposes.routes';
// Charges management
import chargeRoutes from './charges.routes';
// Loan Engine
import loanEngineRoutes from './loan-engine.routes';

const router = Router();

// API Version prefix
const apiVersion = getVersionPrefix(CURRENT_VERSION);

// Route definitions - All endpoints will be accessible at /api/v1/...
router.use(`${apiVersion}/auth`, authRoutes);
router.use(`${apiVersion}/organizations`, organizationRoutes);
router.use(`${apiVersion}/users`, userRoutes);
router.use(`${apiVersion}/clients`, clientRoutes);
router.use(`${apiVersion}/loans`, loanRoutes);
router.use(`${apiVersion}/loan-demos`, loanDemoRoutes);
router.use(`${apiVersion}/payments`, paymentRoutes);
router.use(`${apiVersion}/groups`, groupRoutes);
router.use(`${apiVersion}/employers`, employerRoutes);
router.use(`${apiVersion}/reports`, reportRoutes);
router.use(`${apiVersion}/settings`, settingsRoutes);
router.use(`${apiVersion}/exchange-rates`, exchangeRateRoutes);
router.use(`${apiVersion}/loan-categories`, loanCategoryRoutes);
router.use(`${apiVersion}/loan-products`, loanProductRoutes);
router.use(`${apiVersion}/loan-workflow`, loanWorkflowRoutes);
router.use(`${apiVersion}/shops`, shopRoutes);
router.use(`${apiVersion}/loan-items`, loanItemRoutes);
router.use(`${apiVersion}/online-applications`, onlineApplicationRoutes);
router.use(`${apiVersion}/roles`, roleRoutes);
router.use(`${apiVersion}/audit`, auditRoutes);
router.use(`${apiVersion}/public`, publicRoutes);
router.use(`${apiVersion}/uploads`, uploadRoutes);
router.use(`${apiVersion}/sync`, syncRoutes);

// Phase 14-19 routes
router.use(`${apiVersion}/notifications`, notificationRoutes);
router.use(`${apiVersion}/import`, importRoutes);
router.use(`${apiVersion}/dashboard`, dashboardRoutes);
router.use(`${apiVersion}/enhanced-reports`, enhancedReportRoutes);
router.use(`${apiVersion}/branches`, branchRoutes);
router.use(`${apiVersion}/user-management`, userManagementRoutes);
router.use(`${apiVersion}/payment-enhancements`, paymentEnhancementRoutes);
router.use(`${apiVersion}/loan-adjustments`, loanAdjustmentRoutes);

// Phase 20 routes - Security Hardening
router.use(`${apiVersion}/security`, securityRoutes);
router.use(`${apiVersion}/encryption`, encryptionRoutes);

// Client Management routes
router.use(`${apiVersion}/documents`, documentRoutes);
router.use(`${apiVersion}/collaterals`, collateralRoutes);
router.use(`${apiVersion}/ai`, aiRoutes);
router.use(`${apiVersion}/client-drafts`, clientDraftRoutes);

// Currency management
router.use(`${apiVersion}/currencies`, currencyRoutes);

// Financial Management routes
router.use(`${apiVersion}/payment-methods`, paymentMethodRoutes);
router.use(`${apiVersion}/income-categories`, incomeCategoryRoutes);
router.use(`${apiVersion}/expense-categories`, expenseCategoryRoutes);
router.use(`${apiVersion}/financial-transactions`, financialTransactionRoutes);

// Notes module
router.use(`${apiVersion}/notes`, notesRoutes);

// Loan configuration
router.use(`${apiVersion}/loan-purposes`, loanPurposeRoutes);

// Charges management
router.use(`${apiVersion}/charges`, chargeRoutes);

// Loan Engine - Auto calculation and status management
router.use(`${apiVersion}/loan-engine`, loanEngineRoutes);

// Unversioned health check endpoint (for load balancers, etc.)
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: process.env.API_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    api_version: 'v1',
  });
});

// Versioned health check endpoint
router.get(`${apiVersion}/health`, (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: process.env.API_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    api_version: 'v1',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// API information endpoint
router.get(`${apiVersion}`, (req, res) => {
  const versionInfo = getVersionInfo();
  res.json({
    name: 'Microfinex API',
    version: CURRENT_VERSION,
    description: 'Modern Microfinance Management System API',
    ...versionInfo,
    endpoints: {
      auth: `/api${apiVersion}/auth`,
      organizations: `/api${apiVersion}/organizations`,
      users: `/api${apiVersion}/users`,
      clients: `/api${apiVersion}/clients`,
      loans: `/api${apiVersion}/loans`,
      payments: `/api${apiVersion}/payments`,
      groups: `/api${apiVersion}/groups`,
      employers: `/api${apiVersion}/employers`,
      reports: `/api${apiVersion}/reports`,
      health: `/api${apiVersion}/health`,
    },
    timestamp: new Date().toISOString(),
  });
});

// API documentation routes
router.get('/docs', (req, res) => {
  res.redirect(`/api${apiVersion}`);
});

// Legacy API docs route (for backward compatibility) - removed since we now have Swagger at /api-docs

router.get(`${apiVersion}/docs`, (req, res) => {
  const versionInfo = getVersionInfo();
  res.json({
    name: 'Microfinex API Documentation',
    version: CURRENT_VERSION,
    description: 'Modern Microfinance Management System API',
    ...versionInfo,
    base_url: `/api${apiVersion}`,
    endpoints: {
      // Authentication Endpoints
      auth: {
        login: `POST /api${apiVersion}/auth/login`,
        register: `POST /api${apiVersion}/auth/register`,
        refresh: `POST /api${apiVersion}/auth/refresh`,
        logout: `POST /api${apiVersion}/auth/logout`,
      },
      // Organization Management
      organizations: {
        list: `GET /api${apiVersion}/organizations`,
        create: `POST /api${apiVersion}/organizations`,
        get: `GET /api${apiVersion}/organizations/:id`,
        update: `PUT /api${apiVersion}/organizations/:id`,
      },
      // User Management
      users: {
        list: `GET /api${apiVersion}/users`,
        create: `POST /api${apiVersion}/users`,
        get: `GET /api${apiVersion}/users/:id`,
        update: `PUT /api${apiVersion}/users/:id`,
      },
      // Client Management
      clients: {
        list: `GET /api${apiVersion}/clients`,
        create: `POST /api${apiVersion}/clients`,
        get: `GET /api${apiVersion}/clients/:id`,
        update: `PUT /api${apiVersion}/clients/:id`,
        kyc_status: `PUT /api${apiVersion}/clients/:id/kyc-status`,
        kyc_documents: `POST /api${apiVersion}/clients/:id/kyc-documents`,
      },
      // Loan Management
      loans: {
        list: `GET /api${apiVersion}/loans`,
        create: `POST /api${apiVersion}/loans`,
        get: `GET /api${apiVersion}/loans/:id`,
        approve: `POST /api${apiVersion}/loans/:id/approve`,
        reject: `POST /api${apiVersion}/loans/:id/reject`,
        disburse: `POST /api${apiVersion}/loans/:id/disburse`,
        calculate: `POST /api${apiVersion}/loans/calculate`,
      },
      // Payment Processing
      payments: {
        list: `GET /api${apiVersion}/payments`,
        create: `POST /api${apiVersion}/payments`,
        reverse: `PUT /api${apiVersion}/payments/:id/reverse`,
        history: `GET /api${apiVersion}/payments/history/:loanId`,
        schedule: `GET /api${apiVersion}/payments/schedule/:loanId`,
        overdue: `GET /api${apiVersion}/payments/overdue/:loanId`,
      },
      // Group Management
      groups: {
        list: `GET /api${apiVersion}/groups`,
        create: `POST /api${apiVersion}/groups`,
        get: `GET /api${apiVersion}/groups/:id`,
        update: `PUT /api${apiVersion}/groups/:id`,
      },
      // Employer Management
      employers: {
        list: `GET /api${apiVersion}/employers`,
        create: `POST /api${apiVersion}/employers`,
        get: `GET /api${apiVersion}/employers/:id`,
        update: `PUT /api${apiVersion}/employers/:id`,
      },
      // Reporting
      reports: {
        portfolio: `GET /api${apiVersion}/reports/portfolio`,
        financial: `GET /api${apiVersion}/reports/financial`,
        client_summary: `GET /api${apiVersion}/reports/clients`,
        loan_summary: `GET /api${apiVersion}/reports/loans`,
      },
      // System Endpoints
      system: {
        health: `GET /api${apiVersion}/health`,
        version: `GET /api${apiVersion}`,
      },
    },
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer YOUR_TOKEN',
      note: 'Most endpoints require authentication. Get token from /auth/login',
    },
    examples: {
      login: {
        url: `/api${apiVersion}/auth/login`,
        method: 'POST',
        body: {
          email: 'user@example.com',
          password: 'your_password',
        },
      },
      create_client: {
        url: `/api${apiVersion}/clients`,
        method: 'POST',
        headers: {
          Authorization: 'Bearer YOUR_TOKEN',
          'Content-Type': 'application/json',
        },
        body: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          phoneNumber: '+1234567890',
        },
      },
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
