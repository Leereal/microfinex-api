/**
 * Granular Permissions for Role-Based Access Control (RBAC)
 * Organized by module with consistent naming convention: module:action
 */

// Permission Modules
export const PERMISSION_MODULES = {
  CLIENTS: 'clients',
  LOANS: 'loans',
  LOAN_PRODUCTS: 'loan_products',
  PAYMENTS: 'payments',
  REPORTS: 'reports',
  SETTINGS: 'settings',
  USERS: 'users',
  AUDIT: 'audit',
  ORGANIZATIONS: 'organizations',
  BRANCHES: 'branches',
  ROLES: 'roles',
  PRODUCTS: 'products',
  CATEGORIES: 'categories',
  GROUPS: 'groups',
  EMPLOYERS: 'employers',
  SHOPS: 'shops',
  VISITS: 'visits',
  ASSESSMENTS: 'assessments',
  PLEDGES: 'pledges',
  EXCHANGE_RATES: 'exchange_rates',
  ONLINE_APPLICATIONS: 'online_applications',
  API_KEYS: 'api_keys',
  DASHBOARD: 'dashboard',
  // Client Management
  DOCUMENTS: 'documents',
  COLLATERALS: 'collaterals',
  IMPORTS: 'imports',
  // Financial Management
  PAYMENT_METHODS: 'payment_methods',
  INCOME_CATEGORIES: 'income_categories',
  EXPENSE_CATEGORIES: 'expense_categories',
  FINANCIAL_TRANSACTIONS: 'financial_transactions',
  CHARGES: 'charges',
  // Notes Module
  NOTES: 'notes',
  // AI Module
  AI: 'ai',
} as const;

// Permission interface
export interface PermissionDefinition {
  code: string;
  name: string;
  description: string;
  module: string;
}

// ==================== CLIENT PERMISSIONS ====================
export const CLIENT_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'clients:view',
    name: 'View Clients',
    description: 'View client list and details',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:create',
    name: 'Create Client',
    description: 'Create new clients',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:update',
    name: 'Update Client',
    description: 'Update client information',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:delete',
    name: 'Delete Client',
    description: 'Delete or deactivate clients',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:export',
    name: 'Export Clients',
    description: 'Export client data',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:import',
    name: 'Import Clients',
    description: 'Bulk import clients',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:kyc:view',
    name: 'View KYC Documents',
    description: 'View client KYC documents',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:kyc:update',
    name: 'Update KYC Status',
    description: 'Approve/reject KYC documents',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:kyc:upload',
    name: 'Upload KYC Documents',
    description: 'Upload KYC documents for clients',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:limits:view',
    name: 'View Client Limits',
    description: 'View client credit limits',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:limits:update',
    name: 'Update Client Limits',
    description: 'Modify client credit limits',
    module: PERMISSION_MODULES.CLIENTS,
  },
  {
    code: 'clients:statistics',
    name: 'View Client Statistics',
    description: 'Access client analytics and statistics',
    module: PERMISSION_MODULES.CLIENTS,
  },
];

// ==================== LOAN PERMISSIONS ====================
export const LOAN_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'loans:view',
    name: 'View Loans',
    description: 'View loan list and details',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:apply',
    name: 'Apply for Loan',
    description: 'Create new loan applications',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:update',
    name: 'Update Loan',
    description: 'Update loan information',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:delete',
    name: 'Delete Loan',
    description: 'Delete or cancel loan applications',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:assess',
    name: 'Assess Loan',
    description: 'Perform loan assessment',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:approve',
    name: 'Approve Loan',
    description: 'Approve loan applications',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:reject',
    name: 'Reject Loan',
    description: 'Reject loan applications',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:disburse',
    name: 'Disburse Loan',
    description: 'Process loan disbursement',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:topup',
    name: 'Top-up Loan',
    description: 'Process loan top-ups',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:restructure',
    name: 'Restructure Loan',
    description: 'Restructure loan terms',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:writeoff',
    name: 'Write-off Loan',
    description: 'Write-off bad loans',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:recover',
    name: 'Recover Written-off Loan',
    description: 'Recover written-off loans',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:schedule:view',
    name: 'View Repayment Schedule',
    description: 'View loan repayment schedules',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:schedule:modify',
    name: 'Modify Repayment Schedule',
    description: 'Modify repayment schedules',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:waive:interest',
    name: 'Waive Interest',
    description: 'Waive loan interest charges',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:waive:penalty',
    name: 'Waive Penalty',
    description: 'Waive loan penalty charges',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:export',
    name: 'Export Loans',
    description: 'Export loan data',
    module: PERMISSION_MODULES.LOANS,
  },
  {
    code: 'loans:statistics',
    name: 'View Loan Statistics',
    description: 'Access loan analytics and statistics',
    module: PERMISSION_MODULES.LOANS,
  },
];

// ==================== PAYMENT PERMISSIONS ====================
export const PAYMENT_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'payments:view',
    name: 'View Payments',
    description: 'View payment list and details',
    module: PERMISSION_MODULES.PAYMENTS,
  },
  {
    code: 'payments:receive',
    name: 'Receive Payment',
    description: 'Process incoming payments',
    module: PERMISSION_MODULES.PAYMENTS,
  },
  {
    code: 'payments:reverse',
    name: 'Reverse Payment',
    description: 'Reverse processed payments',
    module: PERMISSION_MODULES.PAYMENTS,
  },
  {
    code: 'payments:bulk',
    name: 'Bulk Payment Processing',
    description: 'Process bulk payments',
    module: PERMISSION_MODULES.PAYMENTS,
  },
  {
    code: 'payments:export',
    name: 'Export Payments',
    description: 'Export payment data',
    module: PERMISSION_MODULES.PAYMENTS,
  },
  {
    code: 'payments:receipt:print',
    name: 'Print Receipt',
    description: 'Print payment receipts',
    module: PERMISSION_MODULES.PAYMENTS,
  },
  {
    code: 'payments:receipt:reprint',
    name: 'Reprint Receipt',
    description: 'Reprint payment receipts',
    module: PERMISSION_MODULES.PAYMENTS,
  },
  {
    code: 'payments:statistics',
    name: 'View Payment Statistics',
    description: 'Access payment analytics',
    module: PERMISSION_MODULES.PAYMENTS,
  },
  {
    code: 'payments:reconcile',
    name: 'Reconcile Payments',
    description: 'Perform payment reconciliation',
    module: PERMISSION_MODULES.PAYMENTS,
  },
];

// ==================== VISIT PERMISSIONS ====================
export const VISIT_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'visits:view',
    name: 'View Visits',
    description: 'View visit records',
    module: PERMISSION_MODULES.VISITS,
  },
  {
    code: 'visits:create',
    name: 'Create Visit',
    description: 'Schedule and record visits',
    module: PERMISSION_MODULES.VISITS,
  },
  {
    code: 'visits:update',
    name: 'Update Visit',
    description: 'Update visit details',
    module: PERMISSION_MODULES.VISITS,
  },
  {
    code: 'visits:delete',
    name: 'Delete Visit',
    description: 'Delete visit records',
    module: PERMISSION_MODULES.VISITS,
  },
  {
    code: 'visits:assign',
    name: 'Assign Visit',
    description: 'Assign visits to officers',
    module: PERMISSION_MODULES.VISITS,
  },
];

// ==================== ASSESSMENT PERMISSIONS ====================
export const ASSESSMENT_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'assessments:view',
    name: 'View Assessments',
    description: 'View loan assessments',
    module: PERMISSION_MODULES.ASSESSMENTS,
  },
  {
    code: 'assessments:create',
    name: 'Create Assessment',
    description: 'Create loan assessments',
    module: PERMISSION_MODULES.ASSESSMENTS,
  },
  {
    code: 'assessments:update',
    name: 'Update Assessment',
    description: 'Update assessment details',
    module: PERMISSION_MODULES.ASSESSMENTS,
  },
  {
    code: 'assessments:approve',
    name: 'Approve Assessment',
    description: 'Approve assessments',
    module: PERMISSION_MODULES.ASSESSMENTS,
  },
  {
    code: 'assessments:reject',
    name: 'Reject Assessment',
    description: 'Reject assessments',
    module: PERMISSION_MODULES.ASSESSMENTS,
  },
];

// ==================== PLEDGE/COLLATERAL PERMISSIONS ====================
export const PLEDGE_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'pledges:view',
    name: 'View Pledges',
    description: 'View security pledges',
    module: PERMISSION_MODULES.PLEDGES,
  },
  {
    code: 'pledges:create',
    name: 'Create Pledge',
    description: 'Register security pledges',
    module: PERMISSION_MODULES.PLEDGES,
  },
  {
    code: 'pledges:update',
    name: 'Update Pledge',
    description: 'Update pledge details',
    module: PERMISSION_MODULES.PLEDGES,
  },
  {
    code: 'pledges:release',
    name: 'Release Pledge',
    description: 'Release pledged items',
    module: PERMISSION_MODULES.PLEDGES,
  },
  {
    code: 'pledges:seize',
    name: 'Seize Pledge',
    description: 'Mark pledges as seized',
    module: PERMISSION_MODULES.PLEDGES,
  },
];

// ==================== REPORT PERMISSIONS ====================
export const REPORT_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'reports:view',
    name: 'View Reports',
    description: 'Access report dashboard',
    module: PERMISSION_MODULES.REPORTS,
  },
  {
    code: 'reports:generate',
    name: 'Generate Reports',
    description: 'Generate custom reports',
    module: PERMISSION_MODULES.REPORTS,
  },
  {
    code: 'reports:export',
    name: 'Export Reports',
    description: 'Export reports to file',
    module: PERMISSION_MODULES.REPORTS,
  },
  {
    code: 'reports:schedule',
    name: 'Schedule Reports',
    description: 'Schedule automated reports',
    module: PERMISSION_MODULES.REPORTS,
  },
  {
    code: 'reports:portfolio',
    name: 'Portfolio Reports',
    description: 'View portfolio reports',
    module: PERMISSION_MODULES.REPORTS,
  },
  {
    code: 'reports:financial',
    name: 'Financial Reports',
    description: 'View financial reports',
    module: PERMISSION_MODULES.REPORTS,
  },
  {
    code: 'reports:regulatory',
    name: 'Regulatory Reports',
    description: 'View regulatory compliance reports',
    module: PERMISSION_MODULES.REPORTS,
  },
  {
    code: 'reports:aging',
    name: 'Aging Reports',
    description: 'View loan aging reports',
    module: PERMISSION_MODULES.REPORTS,
  },
];

// ==================== SETTINGS PERMISSIONS ====================
export const SETTINGS_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'settings:view',
    name: 'View Settings',
    description: 'View system settings',
    module: PERMISSION_MODULES.SETTINGS,
  },
  {
    code: 'settings:update',
    name: 'Update Settings',
    description: 'Modify system settings',
    module: PERMISSION_MODULES.SETTINGS,
  },
  {
    code: 'settings:reset',
    name: 'Reset Settings',
    description: 'Reset settings to defaults',
    module: PERMISSION_MODULES.SETTINGS,
  },
];

// ==================== USER PERMISSIONS ====================
export const USER_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'users:view',
    name: 'View Users',
    description: 'View user list and details',
    module: PERMISSION_MODULES.USERS,
  },
  {
    code: 'users:create',
    name: 'Create User',
    description: 'Create new users',
    module: PERMISSION_MODULES.USERS,
  },
  {
    code: 'users:update',
    name: 'Update User',
    description: 'Update user information',
    module: PERMISSION_MODULES.USERS,
  },
  {
    code: 'users:delete',
    name: 'Delete User',
    description: 'Delete or deactivate users',
    module: PERMISSION_MODULES.USERS,
  },
  {
    code: 'users:activate',
    name: 'Activate/Deactivate User',
    description: 'Toggle user active status',
    module: PERMISSION_MODULES.USERS,
  },
  {
    code: 'users:reset_password',
    name: 'Reset User Password',
    description: 'Reset other users passwords',
    module: PERMISSION_MODULES.USERS,
  },
  {
    code: 'users:assign_role',
    name: 'Assign Roles',
    description: 'Assign roles to users',
    module: PERMISSION_MODULES.USERS,
  },
  {
    code: 'users:assign_branch',
    name: 'Assign Branch',
    description: 'Assign users to branches',
    module: PERMISSION_MODULES.USERS,
  },
  {
    code: 'users:permissions:view',
    name: 'View User Permissions',
    description: 'View user permission details',
    module: PERMISSION_MODULES.USERS,
  },
  {
    code: 'users:permissions:manage',
    name: 'Manage User Permissions',
    description: 'Grant/revoke direct permissions',
    module: PERMISSION_MODULES.USERS,
  },
];

// ==================== ROLE PERMISSIONS ====================
export const ROLE_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'roles:view',
    name: 'View Roles',
    description: 'View role list and details',
    module: PERMISSION_MODULES.ROLES,
  },
  {
    code: 'roles:create',
    name: 'Create Role',
    description: 'Create new roles',
    module: PERMISSION_MODULES.ROLES,
  },
  {
    code: 'roles:update',
    name: 'Update Role',
    description: 'Update role information',
    module: PERMISSION_MODULES.ROLES,
  },
  {
    code: 'roles:delete',
    name: 'Delete Role',
    description: 'Delete roles',
    module: PERMISSION_MODULES.ROLES,
  },
  {
    code: 'roles:permissions:manage',
    name: 'Manage Role Permissions',
    description: 'Assign permissions to roles',
    module: PERMISSION_MODULES.ROLES,
  },
];

// ==================== AUDIT PERMISSIONS ====================
export const AUDIT_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'audit:view',
    name: 'View Audit Logs',
    description: 'View audit trail',
    module: PERMISSION_MODULES.AUDIT,
  },
  {
    code: 'audit:export',
    name: 'Export Audit Logs',
    description: 'Export audit data',
    module: PERMISSION_MODULES.AUDIT,
  },
  {
    code: 'audit:search',
    name: 'Search Audit Logs',
    description: 'Advanced audit search',
    module: PERMISSION_MODULES.AUDIT,
  },
  {
    code: 'audit:history',
    name: 'View Record History',
    description: 'View change history of records',
    module: PERMISSION_MODULES.AUDIT,
  },
];

// ==================== ORGANIZATION PERMISSIONS ====================
export const ORGANIZATION_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'organizations:view',
    name: 'View Organizations',
    description: 'View organization details',
    module: PERMISSION_MODULES.ORGANIZATIONS,
  },
  {
    code: 'organizations:create',
    name: 'Create Organization',
    description: 'Create new organizations',
    module: PERMISSION_MODULES.ORGANIZATIONS,
  },
  {
    code: 'organizations:update',
    name: 'Update Organization',
    description: 'Update organization settings',
    module: PERMISSION_MODULES.ORGANIZATIONS,
  },
  {
    code: 'organizations:delete',
    name: 'Delete Organization',
    description: 'Delete organizations',
    module: PERMISSION_MODULES.ORGANIZATIONS,
  },
  {
    code: 'organizations:activate',
    name: 'Activate/Deactivate',
    description: 'Toggle organization status',
    module: PERMISSION_MODULES.ORGANIZATIONS,
  },
];

// ==================== BRANCH PERMISSIONS ====================
export const BRANCH_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'branches:view',
    name: 'View Branches',
    description: 'View branch list and details',
    module: PERMISSION_MODULES.BRANCHES,
  },
  {
    code: 'branches:create',
    name: 'Create Branch',
    description: 'Create new branches',
    module: PERMISSION_MODULES.BRANCHES,
  },
  {
    code: 'branches:update',
    name: 'Update Branch',
    description: 'Update branch information',
    module: PERMISSION_MODULES.BRANCHES,
  },
  {
    code: 'branches:delete',
    name: 'Delete Branch',
    description: 'Delete or deactivate branches',
    module: PERMISSION_MODULES.BRANCHES,
  },
  {
    code: 'branches:transfer',
    name: 'Transfer Between Branches',
    description: 'Transfer clients/loans between branches',
    module: PERMISSION_MODULES.BRANCHES,
  },
];

// ==================== PRODUCT PERMISSIONS ====================
export const PRODUCT_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'products:view',
    name: 'View Loan Products',
    description: 'View loan products',
    module: PERMISSION_MODULES.PRODUCTS,
  },
  {
    code: 'products:create',
    name: 'Create Loan Product',
    description: 'Create new loan products',
    module: PERMISSION_MODULES.PRODUCTS,
  },
  {
    code: 'products:update',
    name: 'Update Loan Product',
    description: 'Update loan products',
    module: PERMISSION_MODULES.PRODUCTS,
  },
  {
    code: 'products:delete',
    name: 'Delete Loan Product',
    description: 'Delete loan products',
    module: PERMISSION_MODULES.PRODUCTS,
  },
  {
    code: 'products:activate',
    name: 'Activate/Deactivate Product',
    description: 'Toggle product status',
    module: PERMISSION_MODULES.PRODUCTS,
  },
];

// ==================== LOAN PRODUCT PERMISSIONS (alternate module) ====================
export const LOAN_PRODUCT_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'loan_products:view',
    name: 'View Loan Products',
    description: 'View loan products',
    module: PERMISSION_MODULES.LOAN_PRODUCTS,
  },
  {
    code: 'loan_products:create',
    name: 'Create Loan Product',
    description: 'Create new loan products',
    module: PERMISSION_MODULES.LOAN_PRODUCTS,
  },
  {
    code: 'loan_products:update',
    name: 'Update Loan Product',
    description: 'Update loan products including charge assignments',
    module: PERMISSION_MODULES.LOAN_PRODUCTS,
  },
  {
    code: 'loan_products:delete',
    name: 'Delete Loan Product',
    description: 'Delete loan products',
    module: PERMISSION_MODULES.LOAN_PRODUCTS,
  },
];

// ==================== CATEGORY PERMISSIONS ====================
export const CATEGORY_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'categories:view',
    name: 'View Loan Categories',
    description: 'View loan categories',
    module: PERMISSION_MODULES.CATEGORIES,
  },
  {
    code: 'categories:create',
    name: 'Create Loan Category',
    description: 'Create new loan categories',
    module: PERMISSION_MODULES.CATEGORIES,
  },
  {
    code: 'categories:update',
    name: 'Update Loan Category',
    description: 'Update loan categories',
    module: PERMISSION_MODULES.CATEGORIES,
  },
  {
    code: 'categories:delete',
    name: 'Delete Loan Category',
    description: 'Delete loan categories',
    module: PERMISSION_MODULES.CATEGORIES,
  },
];

// ==================== GROUP PERMISSIONS ====================
export const GROUP_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'groups:view',
    name: 'View Groups',
    description: 'View client groups',
    module: PERMISSION_MODULES.GROUPS,
  },
  {
    code: 'groups:create',
    name: 'Create Group',
    description: 'Create new groups',
    module: PERMISSION_MODULES.GROUPS,
  },
  {
    code: 'groups:update',
    name: 'Update Group',
    description: 'Update group information',
    module: PERMISSION_MODULES.GROUPS,
  },
  {
    code: 'groups:delete',
    name: 'Delete Group',
    description: 'Delete groups',
    module: PERMISSION_MODULES.GROUPS,
  },
  {
    code: 'groups:members:manage',
    name: 'Manage Group Members',
    description: 'Add/remove group members',
    module: PERMISSION_MODULES.GROUPS,
  },
];

// ==================== EMPLOYER PERMISSIONS ====================
export const EMPLOYER_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'employers:view',
    name: 'View Employers',
    description: 'View employer list',
    module: PERMISSION_MODULES.EMPLOYERS,
  },
  {
    code: 'employers:create',
    name: 'Create Employer',
    description: 'Create new employers',
    module: PERMISSION_MODULES.EMPLOYERS,
  },
  {
    code: 'employers:update',
    name: 'Update Employer',
    description: 'Update employer information',
    module: PERMISSION_MODULES.EMPLOYERS,
  },
  {
    code: 'employers:delete',
    name: 'Delete Employer',
    description: 'Delete employers',
    module: PERMISSION_MODULES.EMPLOYERS,
  },
];

// ==================== SHOP PERMISSIONS ====================
export const SHOP_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'shops:view',
    name: 'View Shops',
    description: 'View shop list',
    module: PERMISSION_MODULES.SHOPS,
  },
  {
    code: 'shops:create',
    name: 'Create Shop',
    description: 'Create new shops',
    module: PERMISSION_MODULES.SHOPS,
  },
  {
    code: 'shops:update',
    name: 'Update Shop',
    description: 'Update shop information',
    module: PERMISSION_MODULES.SHOPS,
  },
  {
    code: 'shops:delete',
    name: 'Delete Shop',
    description: 'Delete shops',
    module: PERMISSION_MODULES.SHOPS,
  },
  {
    code: 'shops:products:manage',
    name: 'Manage Shop Products',
    description: 'Manage products in shops',
    module: PERMISSION_MODULES.SHOPS,
  },
];

// ==================== EXCHANGE RATE PERMISSIONS ====================
export const EXCHANGE_RATE_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'exchange_rates:view',
    name: 'View Exchange Rates',
    description: 'View exchange rates',
    module: PERMISSION_MODULES.EXCHANGE_RATES,
  },
  {
    code: 'exchange_rates:create',
    name: 'Set Exchange Rates',
    description: 'Set new exchange rates',
    module: PERMISSION_MODULES.EXCHANGE_RATES,
  },
  {
    code: 'exchange_rates:history',
    name: 'View Rate History',
    description: 'View exchange rate history',
    module: PERMISSION_MODULES.EXCHANGE_RATES,
  },
];

// ==================== ONLINE APPLICATION PERMISSIONS ====================
export const ONLINE_APPLICATION_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'online_applications:view',
    name: 'View Online Applications',
    description: 'View online applications',
    module: PERMISSION_MODULES.ONLINE_APPLICATIONS,
  },
  {
    code: 'online_applications:process',
    name: 'Process Online Applications',
    description: 'Process pending applications',
    module: PERMISSION_MODULES.ONLINE_APPLICATIONS,
  },
  {
    code: 'online_applications:verify',
    name: 'Verify Online Applications',
    description: 'Verify applicant information',
    module: PERMISSION_MODULES.ONLINE_APPLICATIONS,
  },
];

// ==================== API KEY PERMISSIONS ====================
export const API_KEY_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'api_keys:view',
    name: 'View API Keys',
    description: 'View API keys',
    module: PERMISSION_MODULES.API_KEYS,
  },
  {
    code: 'api_keys:create',
    name: 'Create API Key',
    description: 'Generate new API keys',
    module: PERMISSION_MODULES.API_KEYS,
  },
  {
    code: 'api_keys:revoke',
    name: 'Revoke API Key',
    description: 'Revoke API keys',
    module: PERMISSION_MODULES.API_KEYS,
  },
];

// ==================== DASHBOARD PERMISSIONS ====================
export const DASHBOARD_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'dashboard:view',
    name: 'View Dashboard',
    description: 'Access main dashboard',
    module: PERMISSION_MODULES.DASHBOARD,
  },
  {
    code: 'dashboard:analytics',
    name: 'View Analytics',
    description: 'Access analytics widgets',
    module: PERMISSION_MODULES.DASHBOARD,
  },
  {
    code: 'dashboard:customize',
    name: 'Customize Dashboard',
    description: 'Customize dashboard layout',
    module: PERMISSION_MODULES.DASHBOARD,
  },
];

// ==================== DOCUMENT PERMISSIONS ====================
export const DOCUMENT_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'documents:view',
    name: 'View Documents',
    description: 'View client documents',
    module: PERMISSION_MODULES.DOCUMENTS,
  },
  {
    code: 'documents:create',
    name: 'Upload Documents',
    description: 'Upload client documents',
    module: PERMISSION_MODULES.DOCUMENTS,
  },
  {
    code: 'documents:verify',
    name: 'Verify Documents',
    description: 'Verify and approve documents',
    module: PERMISSION_MODULES.DOCUMENTS,
  },
  {
    code: 'documents:delete',
    name: 'Delete Documents',
    description: 'Delete client documents',
    module: PERMISSION_MODULES.DOCUMENTS,
  },
  {
    code: 'documents:extract',
    name: 'Extract Document Data',
    description: 'Use AI to extract data from documents',
    module: PERMISSION_MODULES.DOCUMENTS,
  },
  {
    code: 'documents:manage',
    name: 'Manage Document Types',
    description: 'Create and manage document types',
    module: PERMISSION_MODULES.DOCUMENTS,
  },
];

// ==================== COLLATERAL PERMISSIONS ====================
export const COLLATERAL_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'collaterals:view',
    name: 'View Collaterals',
    description: 'View client collaterals',
    module: PERMISSION_MODULES.COLLATERALS,
  },
  {
    code: 'collaterals:create',
    name: 'Create Collateral',
    description: 'Add collateral for clients',
    module: PERMISSION_MODULES.COLLATERALS,
  },
  {
    code: 'collaterals:update',
    name: 'Update Collateral',
    description: 'Update collateral information',
    module: PERMISSION_MODULES.COLLATERALS,
  },
  {
    code: 'collaterals:delete',
    name: 'Delete Collateral',
    description: 'Remove collateral records',
    module: PERMISSION_MODULES.COLLATERALS,
  },
  {
    code: 'collaterals:manage',
    name: 'Manage Collateral Types',
    description: 'Create and manage collateral types',
    module: PERMISSION_MODULES.COLLATERALS,
  },
  {
    code: 'collaterals:valuate',
    name: 'Valuate Collateral',
    description: 'Update collateral valuation',
    module: PERMISSION_MODULES.COLLATERALS,
  },
];

// ==================== IMPORT PERMISSIONS ====================
export const IMPORT_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'imports:view',
    name: 'View Import Jobs',
    description: 'View import job history',
    module: PERMISSION_MODULES.IMPORTS,
  },
  {
    code: 'imports:create',
    name: 'Create Import',
    description: 'Start bulk data imports',
    module: PERMISSION_MODULES.IMPORTS,
  },
  {
    code: 'imports:cancel',
    name: 'Cancel Import',
    description: 'Cancel pending import jobs',
    module: PERMISSION_MODULES.IMPORTS,
  },
  {
    code: 'imports:delete',
    name: 'Delete Import',
    description: 'Delete import job records',
    module: PERMISSION_MODULES.IMPORTS,
  },
];

// ==================== PAYMENT METHOD PERMISSIONS ====================
export const PAYMENT_METHOD_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'payment_methods:view',
    name: 'View Payment Methods',
    description: 'View payment methods and balances',
    module: PERMISSION_MODULES.PAYMENT_METHODS,
  },
  {
    code: 'payment_methods:create',
    name: 'Create Payment Method',
    description: 'Create new payment methods',
    module: PERMISSION_MODULES.PAYMENT_METHODS,
  },
  {
    code: 'payment_methods:update',
    name: 'Update Payment Method',
    description: 'Update payment method details',
    module: PERMISSION_MODULES.PAYMENT_METHODS,
  },
  {
    code: 'payment_methods:delete',
    name: 'Delete Payment Method',
    description: 'Delete payment methods',
    module: PERMISSION_MODULES.PAYMENT_METHODS,
  },
  {
    code: 'payment_methods:adjust_balance',
    name: 'Adjust Balance',
    description: 'Manually adjust payment method balances',
    module: PERMISSION_MODULES.PAYMENT_METHODS,
  },
  {
    code: 'payment_methods:transfer',
    name: 'Transfer Funds',
    description: 'Transfer funds between payment methods',
    module: PERMISSION_MODULES.PAYMENT_METHODS,
  },
];

// ==================== INCOME CATEGORY PERMISSIONS ====================
export const INCOME_CATEGORY_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'income_categories:view',
    name: 'View Income Categories',
    description: 'View income categories',
    module: PERMISSION_MODULES.INCOME_CATEGORIES,
  },
  {
    code: 'income_categories:create',
    name: 'Create Income Category',
    description: 'Create new income categories',
    module: PERMISSION_MODULES.INCOME_CATEGORIES,
  },
  {
    code: 'income_categories:update',
    name: 'Update Income Category',
    description: 'Update income category details',
    module: PERMISSION_MODULES.INCOME_CATEGORIES,
  },
  {
    code: 'income_categories:delete',
    name: 'Delete Income Category',
    description: 'Delete income categories',
    module: PERMISSION_MODULES.INCOME_CATEGORIES,
  },
];

// ==================== EXPENSE CATEGORY PERMISSIONS ====================
export const EXPENSE_CATEGORY_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'expense_categories:view',
    name: 'View Expense Categories',
    description: 'View expense categories',
    module: PERMISSION_MODULES.EXPENSE_CATEGORIES,
  },
  {
    code: 'expense_categories:create',
    name: 'Create Expense Category',
    description: 'Create new expense categories',
    module: PERMISSION_MODULES.EXPENSE_CATEGORIES,
  },
  {
    code: 'expense_categories:update',
    name: 'Update Expense Category',
    description: 'Update expense category details',
    module: PERMISSION_MODULES.EXPENSE_CATEGORIES,
  },
  {
    code: 'expense_categories:delete',
    name: 'Delete Expense Category',
    description: 'Delete expense categories',
    module: PERMISSION_MODULES.EXPENSE_CATEGORIES,
  },
];

// ==================== FINANCIAL TRANSACTION PERMISSIONS ====================
export const FINANCIAL_TRANSACTION_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'financial_transactions:view',
    name: 'View Financial Transactions',
    description: 'View income and expense transactions',
    module: PERMISSION_MODULES.FINANCIAL_TRANSACTIONS,
  },
  {
    code: 'financial_transactions:create',
    name: 'Create Financial Transaction',
    description: 'Record income and expense transactions',
    module: PERMISSION_MODULES.FINANCIAL_TRANSACTIONS,
  },
  {
    code: 'financial_transactions:update',
    name: 'Update Financial Transaction',
    description: 'Update transaction details',
    module: PERMISSION_MODULES.FINANCIAL_TRANSACTIONS,
  },
  {
    code: 'financial_transactions:void',
    name: 'Void Financial Transaction',
    description: 'Void transactions and reverse balances',
    module: PERMISSION_MODULES.FINANCIAL_TRANSACTIONS,
  },
  {
    code: 'financial_transactions:export',
    name: 'Export Financial Transactions',
    description: 'Export transaction data',
    module: PERMISSION_MODULES.FINANCIAL_TRANSACTIONS,
  },
  {
    code: 'financial_transactions:summary',
    name: 'View Financial Summary',
    description: 'View financial summary and reports',
    module: PERMISSION_MODULES.FINANCIAL_TRANSACTIONS,
  },
];

// ==================== CHARGE PERMISSIONS ====================
export const CHARGE_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'charges:view',
    name: 'View Charges',
    description: 'View charge configurations',
    module: PERMISSION_MODULES.CHARGES,
  },
  {
    code: 'charges:create',
    name: 'Create Charge',
    description: 'Create new charge types and rates',
    module: PERMISSION_MODULES.CHARGES,
  },
  {
    code: 'charges:update',
    name: 'Update Charge',
    description: 'Update charge configurations',
    module: PERMISSION_MODULES.CHARGES,
  },
  {
    code: 'charges:delete',
    name: 'Delete Charge',
    description: 'Delete charge types',
    module: PERMISSION_MODULES.CHARGES,
  },
  {
    code: 'charges:apply',
    name: 'Apply Charge',
    description: 'Apply charges to loans',
    module: PERMISSION_MODULES.CHARGES,
  },
  {
    code: 'charges:waive',
    name: 'Waive Charge',
    description: 'Waive loan charges',
    module: PERMISSION_MODULES.CHARGES,
  },
];

// ==================== NOTE PERMISSIONS ====================
export const NOTE_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'notes:view',
    name: 'View Notes',
    description: 'View notes on entities',
    module: PERMISSION_MODULES.NOTES,
  },
  {
    code: 'notes:create',
    name: 'Create Note',
    description: 'Create notes on entities',
    module: PERMISSION_MODULES.NOTES,
  },
  {
    code: 'notes:update',
    name: 'Update Note',
    description: 'Update own notes',
    module: PERMISSION_MODULES.NOTES,
  },
  {
    code: 'notes:delete',
    name: 'Delete Note',
    description: 'Delete own notes',
    module: PERMISSION_MODULES.NOTES,
  },
  {
    code: 'notes:delete_any',
    name: 'Delete Any Note',
    description: 'Delete any note (admin)',
    module: PERMISSION_MODULES.NOTES,
  },
  {
    code: 'notes:view_private',
    name: 'View Private Notes',
    description: 'View private notes from other users',
    module: PERMISSION_MODULES.NOTES,
  },
];

// ==================== AI PERMISSIONS ====================
export const AI_PERMISSIONS: PermissionDefinition[] = [
  {
    code: 'ai:view',
    name: 'View AI Settings',
    description: 'View AI provider configurations and usage statistics',
    module: PERMISSION_MODULES.AI,
  },
  {
    code: 'ai:manage',
    name: 'Manage AI Settings',
    description:
      'Configure AI providers, update settings, and test connections',
    module: PERMISSION_MODULES.AI,
  },
  {
    code: 'ai:extract',
    name: 'AI Document Extraction',
    description: 'Use AI to extract data from documents',
    module: PERMISSION_MODULES.AI,
  },
];

// ==================== ALL PERMISSIONS ====================
export const ALL_PERMISSIONS: PermissionDefinition[] = [
  ...CLIENT_PERMISSIONS,
  ...LOAN_PERMISSIONS,
  ...PAYMENT_PERMISSIONS,
  ...VISIT_PERMISSIONS,
  ...ASSESSMENT_PERMISSIONS,
  ...PLEDGE_PERMISSIONS,
  ...REPORT_PERMISSIONS,
  ...SETTINGS_PERMISSIONS,
  ...USER_PERMISSIONS,
  ...ROLE_PERMISSIONS,
  ...AUDIT_PERMISSIONS,
  ...ORGANIZATION_PERMISSIONS,
  ...BRANCH_PERMISSIONS,
  ...PRODUCT_PERMISSIONS,
  ...LOAN_PRODUCT_PERMISSIONS,
  ...CATEGORY_PERMISSIONS,
  ...GROUP_PERMISSIONS,
  ...EMPLOYER_PERMISSIONS,
  ...SHOP_PERMISSIONS,
  ...EXCHANGE_RATE_PERMISSIONS,
  ...ONLINE_APPLICATION_PERMISSIONS,
  ...API_KEY_PERMISSIONS,
  ...DASHBOARD_PERMISSIONS,
  // Client Management
  ...DOCUMENT_PERMISSIONS,
  ...COLLATERAL_PERMISSIONS,
  ...IMPORT_PERMISSIONS,
  // Financial Management
  ...PAYMENT_METHOD_PERMISSIONS,
  ...INCOME_CATEGORY_PERMISSIONS,
  ...EXPENSE_CATEGORY_PERMISSIONS,
  ...FINANCIAL_TRANSACTION_PERMISSIONS,
  ...CHARGE_PERMISSIONS,
  // Notes Module
  ...NOTE_PERMISSIONS,
  // AI Module
  ...AI_PERMISSIONS,
];

// ==================== PERMISSION CODES (for easy access) ====================
export const PERMISSIONS = {
  // Clients
  CLIENTS_VIEW: 'clients:view',
  CLIENTS_CREATE: 'clients:create',
  CLIENTS_UPDATE: 'clients:update',
  CLIENTS_DELETE: 'clients:delete',
  CLIENTS_EXPORT: 'clients:export',
  CLIENTS_IMPORT: 'clients:import',
  CLIENTS_KYC_VIEW: 'clients:kyc:view',
  CLIENTS_KYC_UPDATE: 'clients:kyc:update',
  CLIENTS_KYC_UPLOAD: 'clients:kyc:upload',
  CLIENTS_LIMITS_VIEW: 'clients:limits:view',
  CLIENTS_LIMITS_UPDATE: 'clients:limits:update',
  CLIENTS_STATISTICS: 'clients:statistics',

  // Loans
  LOANS_VIEW: 'loans:view',
  LOANS_APPLY: 'loans:apply',
  LOANS_UPDATE: 'loans:update',
  LOANS_DELETE: 'loans:delete',
  LOANS_ASSESS: 'loans:assess',
  LOANS_APPROVE: 'loans:approve',
  LOANS_REJECT: 'loans:reject',
  LOANS_DISBURSE: 'loans:disburse',
  LOANS_TOPUP: 'loans:topup',
  LOANS_RESTRUCTURE: 'loans:restructure',
  LOANS_RESCHEDULE: 'loans:reschedule',
  LOANS_ADJUST: 'loans:adjust',
  LOANS_WRITEOFF: 'loans:writeoff',
  LOANS_RECOVER: 'loans:recover',
  LOANS_SCHEDULE_VIEW: 'loans:schedule:view',
  LOANS_SCHEDULE_MODIFY: 'loans:schedule:modify',
  LOANS_WAIVE_INTEREST: 'loans:waive:interest',
  LOANS_WAIVE_PENALTY: 'loans:waive:penalty',
  LOANS_EXPORT: 'loans:export',
  LOANS_STATISTICS: 'loans:statistics',

  // Payments
  PAYMENTS_VIEW: 'payments:view',
  PAYMENTS_CREATE: 'payments:create',
  PAYMENTS_RECEIVE: 'payments:receive',
  PAYMENTS_REVERSE: 'payments:reverse',
  PAYMENTS_BULK: 'payments:bulk',
  PAYMENTS_EXPORT: 'payments:export',
  PAYMENTS_RECEIPT_PRINT: 'payments:receipt:print',
  PAYMENTS_RECEIPT_REPRINT: 'payments:receipt:reprint',
  PAYMENTS_STATISTICS: 'payments:statistics',
  PAYMENTS_RECONCILE: 'payments:reconcile',

  // Visits
  VISITS_VIEW: 'visits:view',
  VISITS_CREATE: 'visits:create',
  VISITS_UPDATE: 'visits:update',
  VISITS_DELETE: 'visits:delete',
  VISITS_ASSIGN: 'visits:assign',

  // Assessments
  ASSESSMENTS_VIEW: 'assessments:view',
  ASSESSMENTS_CREATE: 'assessments:create',
  ASSESSMENTS_UPDATE: 'assessments:update',
  ASSESSMENTS_APPROVE: 'assessments:approve',
  ASSESSMENTS_REJECT: 'assessments:reject',

  // Pledges
  PLEDGES_VIEW: 'pledges:view',
  PLEDGES_CREATE: 'pledges:create',
  PLEDGES_UPDATE: 'pledges:update',
  PLEDGES_RELEASE: 'pledges:release',
  PLEDGES_SEIZE: 'pledges:seize',

  // Reports
  REPORTS_VIEW: 'reports:view',
  REPORTS_GENERATE: 'reports:generate',
  REPORTS_EXPORT: 'reports:export',
  REPORTS_SCHEDULE: 'reports:schedule',
  REPORTS_PORTFOLIO: 'reports:portfolio',
  REPORTS_FINANCIAL: 'reports:financial',
  REPORTS_REGULATORY: 'reports:regulatory',
  REPORTS_AGING: 'reports:aging',

  // Settings
  SETTINGS_VIEW: 'settings:view',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_RESET: 'settings:reset',

  // Users
  USERS_VIEW: 'users:view',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  USERS_ACTIVATE: 'users:activate',
  USERS_RESET_PASSWORD: 'users:reset_password',
  USERS_ASSIGN_ROLE: 'users:assign_role',
  USERS_ASSIGN_BRANCH: 'users:assign_branch',
  USERS_PERMISSIONS_VIEW: 'users:permissions:view',
  USERS_PERMISSIONS_MANAGE: 'users:permissions:manage',

  // Roles
  ROLES_VIEW: 'roles:view',
  ROLES_CREATE: 'roles:create',
  ROLES_UPDATE: 'roles:update',
  ROLES_DELETE: 'roles:delete',
  ROLES_PERMISSIONS_MANAGE: 'roles:permissions:manage',

  // Audit
  AUDIT_VIEW: 'audit:view',
  AUDIT_EXPORT: 'audit:export',
  AUDIT_SEARCH: 'audit:search',
  AUDIT_HISTORY: 'audit:history',

  // Organizations
  ORGANIZATIONS_VIEW: 'organizations:view',
  ORGANIZATIONS_CREATE: 'organizations:create',
  ORGANIZATIONS_UPDATE: 'organizations:update',
  ORGANIZATIONS_DELETE: 'organizations:delete',
  ORGANIZATIONS_ACTIVATE: 'organizations:activate',

  // Branches
  BRANCHES_VIEW: 'branches:view',
  BRANCHES_CREATE: 'branches:create',
  BRANCHES_UPDATE: 'branches:update',
  BRANCHES_DELETE: 'branches:delete',
  BRANCHES_TRANSFER: 'branches:transfer',

  // Products
  PRODUCTS_VIEW: 'products:view',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_ACTIVATE: 'products:activate',

  // Categories
  CATEGORIES_VIEW: 'categories:view',
  CATEGORIES_CREATE: 'categories:create',
  CATEGORIES_UPDATE: 'categories:update',
  CATEGORIES_DELETE: 'categories:delete',

  // Groups
  GROUPS_VIEW: 'groups:view',
  GROUPS_CREATE: 'groups:create',
  GROUPS_UPDATE: 'groups:update',
  GROUPS_DELETE: 'groups:delete',
  GROUPS_MEMBERS_MANAGE: 'groups:members:manage',

  // Employers
  EMPLOYERS_VIEW: 'employers:view',
  EMPLOYERS_CREATE: 'employers:create',
  EMPLOYERS_UPDATE: 'employers:update',
  EMPLOYERS_DELETE: 'employers:delete',

  // Shops
  SHOPS_VIEW: 'shops:view',
  SHOPS_CREATE: 'shops:create',
  SHOPS_UPDATE: 'shops:update',
  SHOPS_DELETE: 'shops:delete',
  SHOPS_PRODUCTS_MANAGE: 'shops:products:manage',

  // Exchange Rates
  EXCHANGE_RATES_VIEW: 'exchange_rates:view',
  EXCHANGE_RATES_CREATE: 'exchange_rates:create',
  EXCHANGE_RATES_HISTORY: 'exchange_rates:history',

  // Online Applications
  ONLINE_APPLICATIONS_VIEW: 'online_applications:view',
  ONLINE_APPLICATIONS_PROCESS: 'online_applications:process',
  ONLINE_APPLICATIONS_VERIFY: 'online_applications:verify',

  // API Keys
  API_KEYS_VIEW: 'api_keys:view',
  API_KEYS_CREATE: 'api_keys:create',
  API_KEYS_REVOKE: 'api_keys:revoke',

  // Dashboard
  DASHBOARD_VIEW: 'dashboard:view',
  DASHBOARD_ANALYTICS: 'dashboard:analytics',
  DASHBOARD_CUSTOMIZE: 'dashboard:customize',

  // Notifications
  NOTIFICATIONS_VIEW: 'notifications:view',
  NOTIFICATIONS_SEND: 'notifications:send',
  NOTIFICATIONS_BULK: 'notifications:bulk',
  NOTIFICATIONS_MANAGE: 'notifications:manage',

  // Imports
  IMPORTS_VIEW: 'imports:view',
  IMPORTS_CREATE: 'imports:create',
  IMPORTS_CANCEL: 'imports:cancel',
  IMPORTS_DELETE: 'imports:delete',

  // Documents
  DOCUMENTS_VIEW: 'documents:view',
  DOCUMENTS_CREATE: 'documents:create',
  DOCUMENTS_VERIFY: 'documents:verify',
  DOCUMENTS_DELETE: 'documents:delete',
  DOCUMENTS_EXTRACT: 'documents:extract',
  DOCUMENTS_MANAGE: 'documents:manage',

  // Collaterals
  COLLATERALS_VIEW: 'collaterals:view',
  COLLATERALS_CREATE: 'collaterals:create',
  COLLATERALS_UPDATE: 'collaterals:update',
  COLLATERALS_DELETE: 'collaterals:delete',
  COLLATERALS_MANAGE: 'collaterals:manage',
  COLLATERALS_VALUATE: 'collaterals:valuate',

  // Payment Methods
  PAYMENT_METHODS_VIEW: 'payment_methods:view',
  PAYMENT_METHODS_CREATE: 'payment_methods:create',
  PAYMENT_METHODS_UPDATE: 'payment_methods:update',
  PAYMENT_METHODS_DELETE: 'payment_methods:delete',
  PAYMENT_METHODS_ADJUST_BALANCE: 'payment_methods:adjust_balance',
  PAYMENT_METHODS_TRANSFER: 'payment_methods:transfer',

  // Income Categories
  INCOME_CATEGORIES_VIEW: 'income_categories:view',
  INCOME_CATEGORIES_CREATE: 'income_categories:create',
  INCOME_CATEGORIES_UPDATE: 'income_categories:update',
  INCOME_CATEGORIES_DELETE: 'income_categories:delete',

  // Expense Categories
  EXPENSE_CATEGORIES_VIEW: 'expense_categories:view',
  EXPENSE_CATEGORIES_CREATE: 'expense_categories:create',
  EXPENSE_CATEGORIES_UPDATE: 'expense_categories:update',
  EXPENSE_CATEGORIES_DELETE: 'expense_categories:delete',

  // Financial Transactions
  FINANCIAL_TRANSACTIONS_VIEW: 'financial_transactions:view',
  FINANCIAL_TRANSACTIONS_CREATE: 'financial_transactions:create',
  FINANCIAL_TRANSACTIONS_UPDATE: 'financial_transactions:update',
  FINANCIAL_TRANSACTIONS_VOID: 'financial_transactions:void',
  FINANCIAL_TRANSACTIONS_EXPORT: 'financial_transactions:export',
  FINANCIAL_TRANSACTIONS_SUMMARY: 'financial_transactions:summary',

  // Notes
  NOTES_VIEW: 'notes:view',
  NOTES_CREATE: 'notes:create',
  NOTES_UPDATE: 'notes:update',
  NOTES_DELETE: 'notes:delete',
  NOTES_DELETE_ANY: 'notes:delete_any',
  NOTES_VIEW_PRIVATE: 'notes:view_private',

  // AI
  AI_VIEW: 'ai:view',
  AI_MANAGE: 'ai:manage',
  AI_EXTRACT: 'ai:extract',

  // Charges
  CHARGES_VIEW: 'charges:view',
  CHARGES_CREATE: 'charges:create',
  CHARGES_UPDATE: 'charges:update',
  CHARGES_DELETE: 'charges:delete',
  CHARGES_APPLY: 'charges:apply',
  CHARGES_WAIVE: 'charges:waive',

  // Loan Products (alternate module)
  LOAN_PRODUCTS_VIEW: 'loan_products:view',
  LOAN_PRODUCTS_CREATE: 'loan_products:create',
  LOAN_PRODUCTS_UPDATE: 'loan_products:update',
  LOAN_PRODUCTS_DELETE: 'loan_products:delete',
} as const;

// ==================== DEFAULT ROLE PERMISSIONS ====================
export const DEFAULT_ROLE_PERMISSIONS = {
  SUPER_ADMIN: Object.values(PERMISSIONS),

  ADMIN: [
    // Full access except organization and super-admin management
    ...CLIENT_PERMISSIONS.map(p => p.code),
    ...LOAN_PERMISSIONS.map(p => p.code),
    ...PAYMENT_PERMISSIONS.map(p => p.code),
    ...VISIT_PERMISSIONS.map(p => p.code),
    ...ASSESSMENT_PERMISSIONS.map(p => p.code),
    ...PLEDGE_PERMISSIONS.map(p => p.code),
    ...REPORT_PERMISSIONS.map(p => p.code),
    ...SETTINGS_PERMISSIONS.map(p => p.code),
    ...USER_PERMISSIONS.map(p => p.code),
    ...ROLE_PERMISSIONS.map(p => p.code),
    ...AUDIT_PERMISSIONS.map(p => p.code),
    ...BRANCH_PERMISSIONS.map(p => p.code),
    ...PRODUCT_PERMISSIONS.map(p => p.code),
    ...CATEGORY_PERMISSIONS.map(p => p.code),
    ...GROUP_PERMISSIONS.map(p => p.code),
    ...EMPLOYER_PERMISSIONS.map(p => p.code),
    ...SHOP_PERMISSIONS.map(p => p.code),
    ...EXCHANGE_RATE_PERMISSIONS.map(p => p.code),
    ...ONLINE_APPLICATION_PERMISSIONS.map(p => p.code),
    ...API_KEY_PERMISSIONS.map(p => p.code),
    ...DASHBOARD_PERMISSIONS.map(p => p.code),
    // Financial Management
    ...PAYMENT_METHOD_PERMISSIONS.map(p => p.code),
    ...INCOME_CATEGORY_PERMISSIONS.map(p => p.code),
    ...EXPENSE_CATEGORY_PERMISSIONS.map(p => p.code),
    ...FINANCIAL_TRANSACTION_PERMISSIONS.map(p => p.code),
    // Notes Module
    ...NOTE_PERMISSIONS.map(p => p.code),
    // AI Module - ADMIN can manage AI settings
    ...AI_PERMISSIONS.map(p => p.code),
  ],

  // Organization Admin - same as ADMIN but specifically for organization-level management
  ORG_ADMIN: [
    // Full access except organization and super-admin management
    ...CLIENT_PERMISSIONS.map(p => p.code),
    ...LOAN_PERMISSIONS.map(p => p.code),
    ...PAYMENT_PERMISSIONS.map(p => p.code),
    ...VISIT_PERMISSIONS.map(p => p.code),
    ...ASSESSMENT_PERMISSIONS.map(p => p.code),
    ...PLEDGE_PERMISSIONS.map(p => p.code),
    ...REPORT_PERMISSIONS.map(p => p.code),
    ...SETTINGS_PERMISSIONS.map(p => p.code),
    ...USER_PERMISSIONS.map(p => p.code),
    ...ROLE_PERMISSIONS.map(p => p.code),
    ...AUDIT_PERMISSIONS.map(p => p.code),
    ...BRANCH_PERMISSIONS.map(p => p.code),
    ...PRODUCT_PERMISSIONS.map(p => p.code),
    ...CATEGORY_PERMISSIONS.map(p => p.code),
    ...GROUP_PERMISSIONS.map(p => p.code),
    ...EMPLOYER_PERMISSIONS.map(p => p.code),
    ...SHOP_PERMISSIONS.map(p => p.code),
    ...EXCHANGE_RATE_PERMISSIONS.map(p => p.code),
    ...ONLINE_APPLICATION_PERMISSIONS.map(p => p.code),
    ...API_KEY_PERMISSIONS.map(p => p.code),
    ...DASHBOARD_PERMISSIONS.map(p => p.code),
    // Financial Management
    ...PAYMENT_METHOD_PERMISSIONS.map(p => p.code),
    ...INCOME_CATEGORY_PERMISSIONS.map(p => p.code),
    ...EXPENSE_CATEGORY_PERMISSIONS.map(p => p.code),
    ...FINANCIAL_TRANSACTION_PERMISSIONS.map(p => p.code),
    // Notes Module
    ...NOTE_PERMISSIONS.map(p => p.code),
    // AI Module - ORG_ADMIN can manage AI settings
    ...AI_PERMISSIONS.map(p => p.code),
  ],

  MANAGER: [
    // Branch-level management
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.CLIENTS_CREATE,
    PERMISSIONS.CLIENTS_UPDATE,
    PERMISSIONS.CLIENTS_KYC_VIEW,
    PERMISSIONS.CLIENTS_KYC_UPDATE,
    PERMISSIONS.CLIENTS_STATISTICS,
    PERMISSIONS.LOANS_VIEW,
    PERMISSIONS.LOANS_APPLY,
    PERMISSIONS.LOANS_UPDATE,
    PERMISSIONS.LOANS_ASSESS,
    PERMISSIONS.LOANS_APPROVE,
    PERMISSIONS.LOANS_REJECT,
    PERMISSIONS.LOANS_DISBURSE,
    PERMISSIONS.LOANS_STATISTICS,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.PAYMENTS_RECEIVE,
    PERMISSIONS.PAYMENTS_STATISTICS,
    PERMISSIONS.VISITS_VIEW,
    PERMISSIONS.VISITS_CREATE,
    PERMISSIONS.VISITS_UPDATE,
    PERMISSIONS.VISITS_ASSIGN,
    PERMISSIONS.ASSESSMENTS_VIEW,
    PERMISSIONS.ASSESSMENTS_CREATE,
    PERMISSIONS.ASSESSMENTS_UPDATE,
    PERMISSIONS.ASSESSMENTS_APPROVE,
    PERMISSIONS.ASSESSMENTS_REJECT,
    PERMISSIONS.PLEDGES_VIEW,
    PERMISSIONS.PLEDGES_CREATE,
    PERMISSIONS.PLEDGES_UPDATE,
    PERMISSIONS.PLEDGES_RELEASE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.REPORTS_PORTFOLIO,
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_UPDATE,
    PERMISSIONS.GROUPS_VIEW,
    PERMISSIONS.GROUPS_CREATE,
    PERMISSIONS.GROUPS_UPDATE,
    PERMISSIONS.GROUPS_MEMBERS_MANAGE,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.DASHBOARD_ANALYTICS,
    // Financial Management - Managers can view and create transactions
    PERMISSIONS.PAYMENT_METHODS_VIEW,
    PERMISSIONS.PAYMENT_METHODS_CREATE,
    PERMISSIONS.PAYMENT_METHODS_UPDATE,
    PERMISSIONS.INCOME_CATEGORIES_VIEW,
    PERMISSIONS.INCOME_CATEGORIES_CREATE,
    PERMISSIONS.INCOME_CATEGORIES_UPDATE,
    PERMISSIONS.EXPENSE_CATEGORIES_VIEW,
    PERMISSIONS.EXPENSE_CATEGORIES_CREATE,
    PERMISSIONS.EXPENSE_CATEGORIES_UPDATE,
    PERMISSIONS.FINANCIAL_TRANSACTIONS_VIEW,
    PERMISSIONS.FINANCIAL_TRANSACTIONS_CREATE,
    PERMISSIONS.FINANCIAL_TRANSACTIONS_UPDATE,
    PERMISSIONS.FINANCIAL_TRANSACTIONS_VOID,
    PERMISSIONS.FINANCIAL_TRANSACTIONS_SUMMARY,
    // Notes - Managers can view, create, update and delete any
    PERMISSIONS.NOTES_VIEW,
    PERMISSIONS.NOTES_CREATE,
    PERMISSIONS.NOTES_UPDATE,
    PERMISSIONS.NOTES_DELETE,
    PERMISSIONS.NOTES_DELETE_ANY,
    PERMISSIONS.NOTES_VIEW_PRIVATE,
    // AI - Managers can view settings and use AI extraction
    PERMISSIONS.AI_VIEW,
    PERMISSIONS.AI_EXTRACT,
  ],

  LOAN_ASSESSOR: [
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.CLIENTS_KYC_VIEW,
    PERMISSIONS.LOANS_VIEW,
    PERMISSIONS.LOANS_ASSESS,
    PERMISSIONS.VISITS_VIEW,
    PERMISSIONS.VISITS_CREATE,
    PERMISSIONS.VISITS_UPDATE,
    PERMISSIONS.ASSESSMENTS_VIEW,
    PERMISSIONS.ASSESSMENTS_CREATE,
    PERMISSIONS.ASSESSMENTS_UPDATE,
    PERMISSIONS.PLEDGES_VIEW,
    PERMISSIONS.PLEDGES_CREATE,
    PERMISSIONS.PLEDGES_UPDATE,
    PERMISSIONS.DASHBOARD_VIEW,
    // Notes
    PERMISSIONS.NOTES_VIEW,
    PERMISSIONS.NOTES_CREATE,
    PERMISSIONS.NOTES_UPDATE,
    PERMISSIONS.NOTES_DELETE,
    // AI - Loan Assessors can use AI extraction for documents
    PERMISSIONS.AI_EXTRACT,
  ],

  LOAN_OFFICER: [
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.CLIENTS_CREATE,
    PERMISSIONS.CLIENTS_UPDATE,
    PERMISSIONS.CLIENTS_KYC_VIEW,
    PERMISSIONS.CLIENTS_KYC_UPLOAD,
    PERMISSIONS.LOANS_VIEW,
    PERMISSIONS.LOANS_APPLY,
    PERMISSIONS.LOANS_UPDATE,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.PAYMENTS_RECEIVE,
    PERMISSIONS.PAYMENTS_RECEIPT_PRINT,
    PERMISSIONS.VISITS_VIEW,
    PERMISSIONS.VISITS_CREATE,
    PERMISSIONS.GROUPS_VIEW,
    PERMISSIONS.GROUPS_CREATE,
    PERMISSIONS.GROUPS_UPDATE,
    PERMISSIONS.GROUPS_MEMBERS_MANAGE,
    PERMISSIONS.DASHBOARD_VIEW,
    // Notes
    PERMISSIONS.NOTES_VIEW,
    PERMISSIONS.NOTES_CREATE,
    PERMISSIONS.NOTES_UPDATE,
    PERMISSIONS.NOTES_DELETE,
    // AI - Loan Officers can use AI extraction for documents
    PERMISSIONS.AI_EXTRACT,
  ],

  CASHIER: [
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.LOANS_VIEW,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.PAYMENTS_RECEIVE,
    PERMISSIONS.PAYMENTS_RECEIPT_PRINT,
    PERMISSIONS.PAYMENTS_RECEIPT_REPRINT,
    PERMISSIONS.DASHBOARD_VIEW,
    // Financial Management - Cashiers can view and create transactions
    PERMISSIONS.PAYMENT_METHODS_VIEW,
    PERMISSIONS.INCOME_CATEGORIES_VIEW,
    PERMISSIONS.EXPENSE_CATEGORIES_VIEW,
    PERMISSIONS.FINANCIAL_TRANSACTIONS_VIEW,
    PERMISSIONS.FINANCIAL_TRANSACTIONS_CREATE,
    // Notes - Cashiers can view and create
    PERMISSIONS.NOTES_VIEW,
    PERMISSIONS.NOTES_CREATE,
  ],

  VIEWER: [
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.LOANS_VIEW,
    PERMISSIONS.LOANS_SCHEDULE_VIEW,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    // Notes - Viewers can only view
    PERMISSIONS.NOTES_VIEW,
  ],
};

// Type for permission code
export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Helper function to check if a permission code is valid
export function isValidPermission(code: string): boolean {
  return ALL_PERMISSIONS.some(p => p.code === code);
}

// Helper function to get permissions by module
export function getPermissionsByModule(module: string): PermissionDefinition[] {
  return ALL_PERMISSIONS.filter(p => p.module === module);
}

// Helper function to get all permission codes
export function getAllPermissionCodes(): string[] {
  return ALL_PERMISSIONS.map(p => p.code);
}
