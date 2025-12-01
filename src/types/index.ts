// Common types used throughout the application

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  ORG_ADMIN = 'ORG_ADMIN',
  MANAGER = 'MANAGER',
  LOAN_OFFICER = 'LOAN_OFFICER',
  ACCOUNTANT = 'ACCOUNTANT',
  TELLER = 'TELLER',
  STAFF = 'STAFF',
  CLIENT = 'CLIENT',
  API_CLIENT = 'API_CLIENT',
}

export enum LoanStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  ACTIVE = 'ACTIVE',
  OVERDUE = 'OVERDUE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DEFAULTED = 'DEFAULTED',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export enum TransactionType {
  LOAN_DISBURSEMENT = 'LOAN_DISBURSEMENT',
  LOAN_REPAYMENT = 'LOAN_REPAYMENT',
  CHARGE = 'CHARGE',
  PENALTY = 'PENALTY',
  REFUND = 'REFUND',
}

export enum OrganizationType {
  MICROFINANCE = 'MICROFINANCE',
  BANK = 'BANK',
  CREDIT_UNION = 'CREDIT_UNION',
  COOPERATIVE = 'COOPERATIVE',
}

export enum ClientType {
  INDIVIDUAL = 'INDIVIDUAL',
  GROUP = 'GROUP',
  BUSINESS = 'BUSINESS',
}

export enum LoanType {
  PERSONAL = 'PERSONAL',
  BUSINESS = 'BUSINESS',
  AGRICULTURAL = 'AGRICULTURAL',
  EMERGENCY = 'EMERGENCY',
  GROUP = 'GROUP',
}

export enum RepaymentFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  ANNUALLY = 'ANNUALLY',
}

export enum ChargeType {
  PROCESSING_FEE = 'PROCESSING_FEE',
  SERVICE_FEE = 'SERVICE_FEE',
  PENALTY = 'PENALTY',
  LATE_FEE = 'LATE_FEE',
  INSURANCE = 'INSURANCE',
}

export enum ApiTier {
  BASIC = 'BASIC',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
  CUSTOM = 'CUSTOM',
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  organizationId: string | undefined;
  permissions: string[];
  tier: ApiTier;
}

export interface RequestWithUser extends Request {
  user: JWTPayload;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export interface LoanCalculation {
  principal: number;
  interestRate: number;
  term: number;
  frequency: RepaymentFrequency;
  installmentAmount: number;
  totalInterest: number;
  totalAmount: number;
  schedule: PaymentScheduleItem[];
}

export interface PaymentScheduleItem {
  installmentNumber: number;
  dueDate: Date;
  principal: number;
  interest: number;
  totalAmount: number;
  balance: number;
  status: PaymentStatus;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  changes: any;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  database: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    percentage: number;
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}
