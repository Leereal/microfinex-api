--
-- MicroSteward / Microfinex - full database DDL (schema only, no data)
--
-- Generated with:
--   pg_dump --schema-only --no-owner --no-privileges --schema=public "$DATABASE_URL"
--
-- Source server : PostgreSQL 15.8
-- Contents      : 41 enum types, 91 tables, 91 primary keys,
--                 138 indexes, 168 foreign keys
--
-- The 91 tables are the 90 Prisma models plus Prisma's own
-- `_prisma_migrations` bookkeeping table. At generation time the live
-- database matched prisma/schema.prisma exactly - no drift.
--
-- Ownership and grants are deliberately omitted so this runs against any
-- role. To rebuild an empty database:
--   psql "$TARGET_DATABASE_URL" -f prisma/ddl/schema.sql
--
-- Regenerate this file rather than hand-editing it; prisma/schema.prisma
-- remains the source of truth for the application.
--

--
-- PostgreSQL database dump
--

-- Dumped from database version 15.8
-- Dumped by pg_dump version 16.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: AddressType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AddressType" AS ENUM (
    'RESIDENTIAL',
    'BUSINESS',
    'POSTAL',
    'PREVIOUS'
);


--
-- Name: ApiTier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ApiTier" AS ENUM (
    'BASIC',
    'PROFESSIONAL',
    'ENTERPRISE',
    'CUSTOM'
);


--
-- Name: ApplicationSource; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ApplicationSource" AS ENUM (
    'BRANCH',
    'WEB',
    'WHATSAPP',
    'FACEBOOK'
);


--
-- Name: ApplicationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ApplicationStatus" AS ENUM (
    'PENDING',
    'VERIFIED',
    'PROCESSED',
    'EXPIRED',
    'REJECTED'
);


--
-- Name: ApplicationType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ApplicationType" AS ENUM (
    'NEW',
    'EXISTING'
);


--
-- Name: AuditStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AuditStatus" AS ENUM (
    'SUCCESS',
    'FAILURE',
    'PARTIAL'
);


--
-- Name: BusinessType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."BusinessType" AS ENUM (
    'SOLE_PROPRIETOR',
    'PARTNERSHIP',
    'PRIVATE_LIMITED',
    'PUBLIC_LIMITED',
    'COOPERATIVE',
    'TRUST',
    'NGO',
    'OTHER'
);


--
-- Name: ChargeApplication; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ChargeApplication" AS ENUM (
    'PRINCIPAL',
    'BALANCE',
    'OTHER',
    'CASHED_AMOUNT',
    'APPLIED_AMOUNT'
);


--
-- Name: ChargeAppliesAt; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ChargeAppliesAt" AS ENUM (
    'DISBURSEMENT',
    'APPROVAL',
    'SETTLEMENT',
    'LATE_PAYMENT',
    'MONTHLY',
    'MANUAL',
    'REPAYMENT',
    'OVERDUE',
    'CLOSURE',
    'LOAN_CREATION'
);


--
-- Name: ChargeCalculationType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ChargeCalculationType" AS ENUM (
    'PERCENTAGE',
    'FIXED',
    'PERCENTAGE_BALANCE'
);


--
-- Name: ChargeMode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ChargeMode" AS ENUM (
    'MANUAL',
    'AUTO'
);


--
-- Name: ChargeType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ChargeType" AS ENUM (
    'ADMIN_FEE',
    'APPLICATION_FEE',
    'PROCESSING_FEE',
    'SERVICE_FEE',
    'LEGAL_FEE',
    'DOCUMENTATION_FEE',
    'INSURANCE_FEE',
    'STAMP_DUTY',
    'LATE_FEE',
    'PENALTY',
    'EARLY_SETTLEMENT_FEE',
    'COLLECTION_FEE',
    'RESTRUCTURE_FEE',
    'OTHER',
    'INSURANCE',
    'DISBURSEMENT_FEE',
    'EARLY_REPAYMENT_FEE',
    'LATE_PAYMENT_FEE',
    'PENALTY_FEE',
    'VALUATION_FEE'
);


--
-- Name: ClientType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ClientType" AS ENUM (
    'INDIVIDUAL',
    'GROUP',
    'BUSINESS'
);


--
-- Name: CollateralStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CollateralStatus" AS ENUM (
    'AVAILABLE',
    'PLEDGED',
    'RELEASED',
    'REPOSSESSED',
    'SOLD'
);


--
-- Name: ContactType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ContactType" AS ENUM (
    'MOBILE',
    'LANDLINE',
    'EMAIL',
    'FAX'
);


--
-- Name: Currency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Currency" AS ENUM (
    'ZWG',
    'USD',
    'ZAR',
    'BWP',
    'ZIG',
    'KES',
    'NGN',
    'GHS',
    'TZS',
    'UGX',
    'EUR',
    'GBP',
    'JPY',
    'CNY',
    'CAD',
    'AUD',
    'HTG',
    'DOP',
    'JMD',
    'TTD',
    'XCD'
);


--
-- Name: DisbursementPreference; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DisbursementPreference" AS ENUM (
    'CASH',
    'TRANSFER'
);


--
-- Name: DocumentStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DocumentStatus" AS ENUM (
    'PENDING',
    'UPLOADED',
    'VERIFIED',
    'REJECTED',
    'EXPIRED'
);


--
-- Name: DurationUnit; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DurationUnit" AS ENUM (
    'DAYS',
    'WEEKS',
    'MONTHS',
    'YEARS'
);


--
-- Name: FinancialTransactionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."FinancialTransactionStatus" AS ENUM (
    'PENDING',
    'COMPLETED',
    'VOIDED',
    'CANCELLED'
);


--
-- Name: FinancialTransactionType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."FinancialTransactionType" AS ENUM (
    'INCOME',
    'EXPENSE'
);


--
-- Name: ImportStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ImportStatus" AS ENUM (
    'PENDING',
    'VALIDATING',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'PARTIALLY_COMPLETED'
);


--
-- Name: ImportType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ImportType" AS ENUM (
    'CLIENTS',
    'LOANS',
    'PAYMENTS',
    'GROUPS',
    'EMPLOYERS'
);


--
-- Name: LoanCalculationEngineType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LoanCalculationEngineType" AS ENUM (
    'SHORT_TERM',
    'LONG_TERM',
    'REDUCING_BALANCE',
    'FLAT_RATE',
    'CUSTOM'
);


--
-- Name: LoanCalculationMethod; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LoanCalculationMethod" AS ENUM (
    'FLAT_RATE',
    'REDUCING_BALANCE',
    'SIMPLE_INTEREST',
    'COMPOUND_INTEREST',
    'ANNUITY',
    'BALLOON_PAYMENT',
    'CUSTOM_FORMULA'
);


--
-- Name: LoanClass; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LoanClass" AS ENUM (
    'CONSUMER',
    'COMMERCIAL'
);


--
-- Name: LoanStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LoanStatus" AS ENUM (
    'DRAFT',
    'PENDING',
    'PENDING_ASSESSMENT',
    'PENDING_VISIT',
    'PENDING_APPROVAL',
    'APPROVED',
    'PENDING_DISBURSEMENT',
    'ACTIVE',
    'OVERDUE',
    'COMPLETED',
    'CANCELLED',
    'DEFAULTED',
    'WRITTEN_OFF',
    'DEFAULT'
);


--
-- Name: LoanType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LoanType" AS ENUM (
    'SHORT_TERM',
    'LONG_TERM',
    'PRODUCT'
);


--
-- Name: NoteEntityType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NoteEntityType" AS ENUM (
    'CLIENT',
    'LOAN',
    'PAYMENT',
    'DISBURSEMENT',
    'LOAN_APPLICATION',
    'COLLATERAL',
    'GROUP'
);


--
-- Name: NotePriority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NotePriority" AS ENUM (
    'LOW',
    'NORMAL',
    'HIGH',
    'URGENT'
);


--
-- Name: OrganizationType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OrganizationType" AS ENUM (
    'MICROFINANCE',
    'BANK',
    'CREDIT_UNION',
    'COOPERATIVE'
);


--
-- Name: OwnershipStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OwnershipStatus" AS ENUM (
    'FULLY_OWNED',
    'FINANCED',
    'LEASED',
    'JOINT_OWNERSHIP'
);


--
-- Name: PaymentMethodType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PaymentMethodType" AS ENUM (
    'CASH',
    'MOBILE_MONEY',
    'BANK_TRANSFER',
    'CHEQUE',
    'CARD',
    'DIGITAL_WALLET',
    'OTHER'
);


--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'PENDING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'REVERSED',
    'REFUNDED'
);


--
-- Name: RepaymentFrequency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RepaymentFrequency" AS ENUM (
    'DAILY',
    'WEEKLY',
    'BIWEEKLY',
    'MONTHLY',
    'QUARTERLY',
    'SEMI_ANNUAL',
    'ANNUAL'
);


--
-- Name: SyncAction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncAction" AS ENUM (
    'CREATE',
    'UPDATE',
    'DELETE'
);


--
-- Name: SyncStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncStatus" AS ENUM (
    'SYNCED',
    'PENDING',
    'CONFLICT'
);


--
-- Name: TargetType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TargetType" AS ENUM (
    'DISBURSEMENT',
    'REPAYMENT'
);


--
-- Name: TransactionType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TransactionType" AS ENUM (
    'LOAN_DISBURSEMENT',
    'LOAN_TOPUP',
    'LOAN_REPAYMENT',
    'CHARGE',
    'PENALTY',
    'REFUND'
);


--
-- Name: UserRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."UserRole" AS ENUM (
    'SUPER_ADMIN',
    'ADMIN',
    'MANAGER',
    'STAFF',
    'CLIENT',
    'ORG_ADMIN',
    'LOAN_OFFICER',
    'ACCOUNTANT',
    'TELLER',
    'API_CLIENT'
);


--
-- Name: VisitType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."VisitType" AS ENUM (
    'BUSINESS',
    'HOME'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: ai_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_providers (
    id text NOT NULL,
    name text NOT NULL,
    "displayName" text NOT NULL,
    "baseUrl" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "isLocal" boolean DEFAULT false NOT NULL,
    capabilities text[] DEFAULT ARRAY[]::text[],
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id text NOT NULL,
    name text NOT NULL,
    key text NOT NULL,
    "organizationId" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    permissions text[] DEFAULT ARRAY[]::text[],
    "rateLimit" integer,
    "lastUsed" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_api_connectors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_api_connectors (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    description text,
    "baseUrl" text NOT NULL,
    "authType" text DEFAULT 'NONE'::text NOT NULL,
    "authHeaderName" text,
    secret text,
    "allowWrite" boolean DEFAULT false NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "createdById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_approvals (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "runId" text,
    "conversationId" text,
    "automationId" text,
    capability text NOT NULL,
    "toolName" text NOT NULL,
    title text NOT NULL,
    summary text,
    action jsonb NOT NULL,
    "editableFields" text[] DEFAULT ARRAY[]::text[] NOT NULL,
    preview jsonb,
    status text DEFAULT 'PENDING'::text NOT NULL,
    "requestedById" text,
    "decidedById" text,
    "decidedAt" timestamp(3) without time zone,
    "decisionNote" text,
    result jsonb,
    error text,
    "idempotencyKey" text NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "executedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_artifacts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "conversationId" text,
    "runId" text,
    kind text DEFAULT 'ATTACHMENT'::text NOT NULL,
    "fileName" text NOT NULL,
    "mimeType" text NOT NULL,
    "fileSize" integer DEFAULT 0 NOT NULL,
    "storagePath" text NOT NULL,
    metadata jsonb,
    "createdById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: assistant_automation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_automation_runs (
    id text NOT NULL,
    "automationId" text NOT NULL,
    "organizationId" text NOT NULL,
    trigger text DEFAULT 'SCHEDULE'::text NOT NULL,
    status text DEFAULT 'RUNNING'::text NOT NULL,
    "dryRun" boolean DEFAULT false NOT NULL,
    summary text,
    stats jsonb,
    error text,
    "runId" text,
    "startedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone
);


--
-- Name: assistant_automations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_automations (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    schedule jsonb NOT NULL,
    timezone text DEFAULT 'Africa/Harare'::text NOT NULL,
    config jsonb,
    "dryRun" boolean DEFAULT true NOT NULL,
    "ownerId" text NOT NULL,
    "branchId" text,
    "nextRunAt" timestamp(3) without time zone,
    "lastRunAt" timestamp(3) without time zone,
    "lastStatus" text,
    "lastError" text,
    "lockedAt" timestamp(3) without time zone,
    "createdById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_browser_logins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_browser_logins (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    domain text NOT NULL,
    "loginUrl" text NOT NULL,
    username text NOT NULL,
    secret text NOT NULL,
    "usernameSelector" text,
    "passwordSelector" text,
    "submitSelector" text,
    "storageState" text,
    status text DEFAULT 'UNVERIFIED'::text NOT NULL,
    "lastVerifiedAt" timestamp(3) without time zone,
    "lastError" text,
    "createdById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_connections (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    toolkit text NOT NULL,
    label text,
    "accountLabel" text,
    "composioUserId" text NOT NULL,
    "composioAuthConfigId" text,
    "composioAccountId" text,
    status text DEFAULT 'INITIATED'::text NOT NULL,
    "triggerId" text,
    "lastSyncAt" timestamp(3) without time zone,
    "lastError" text,
    "connectedById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_conversations (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text,
    "clientId" text,
    title text,
    channel text DEFAULT 'APP'::text NOT NULL,
    context jsonb,
    "verifiedUntil" timestamp(3) without time zone,
    "handoffUntil" timestamp(3) without time zone,
    "archivedAt" timestamp(3) without time zone,
    "lastMessageAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_mcp_servers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_mcp_servers (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    "authHeaderName" text,
    "authSecret" text,
    enabled boolean DEFAULT false NOT NULL,
    "toolPolicy" jsonb,
    "toolCache" jsonb,
    status text DEFAULT 'UNVERIFIED'::text NOT NULL,
    "lastCheckedAt" timestamp(3) without time zone,
    "lastError" text,
    "createdById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_memories (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    scope text DEFAULT 'ORG'::text NOT NULL,
    "userId" text,
    content text NOT NULL,
    source text DEFAULT 'USER'::text NOT NULL,
    "createdById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_messages (
    id text NOT NULL,
    "conversationId" text NOT NULL,
    "organizationId" text NOT NULL,
    role text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    parts jsonb,
    "providerData" jsonb,
    attachments jsonb,
    "runId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: assistant_outreach; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_outreach (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "automationId" text,
    "loanId" text,
    "clientId" text,
    channel text,
    "messageId" text,
    "dedupeKey" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: assistant_processed_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_processed_emails (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "connectionId" text NOT NULL,
    purpose text NOT NULL,
    "providerMessageId" text NOT NULL,
    outcome text,
    "clientId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: assistant_run_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_run_steps (
    id text NOT NULL,
    "runId" text NOT NULL,
    index integer NOT NULL,
    type text NOT NULL,
    "toolName" text,
    capability text,
    status text DEFAULT 'OK'::text NOT NULL,
    summary text,
    input jsonb,
    output jsonb,
    "durationMs" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: assistant_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_runs (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "conversationId" text,
    trigger text DEFAULT 'CHAT'::text NOT NULL,
    "actingUserId" text,
    "automationId" text,
    "automationRunId" text,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    input jsonb,
    provider text,
    model text,
    steps integer DEFAULT 0 NOT NULL,
    "inputTokens" integer DEFAULT 0 NOT NULL,
    "outputTokens" integer DEFAULT 0 NOT NULL,
    tainted boolean DEFAULT false NOT NULL,
    "cancelRequested" boolean DEFAULT false NOT NULL,
    error text,
    summary text,
    "lockedAt" timestamp(3) without time zone,
    "heartbeatAt" timestamp(3) without time zone,
    "startedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_settings (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    "providerName" text,
    "modelName" text,
    capabilities jsonb,
    instructions text,
    "maxStepsPerRun" integer DEFAULT 12 NOT NULL,
    "monthlyTokenBudget" integer,
    "dailyRunLimit" integer DEFAULT 200 NOT NULL,
    timezone text DEFAULT 'Africa/Harare'::text NOT NULL,
    "workingHours" jsonb,
    "memoryEnabled" boolean DEFAULT true NOT NULL,
    "whatsappEnabled" boolean DEFAULT false NOT NULL,
    "whatsappConfig" jsonb,
    "browserAllowedDomains" text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "updatedById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: assistant_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_usage (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    day date NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    runs integer DEFAULT 0 NOT NULL,
    requests integer DEFAULT 0 NOT NULL,
    "inputTokens" integer DEFAULT 0 NOT NULL,
    "outputTokens" integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    "userId" text,
    "organizationId" text,
    action text NOT NULL,
    resource text NOT NULL,
    "resourceId" text,
    changes jsonb,
    "ipAddress" text,
    "userAgent" text,
    "timestamp" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "branchId" text,
    duration integer,
    "errorMessage" text,
    "newValue" jsonb,
    "previousValue" jsonb,
    "requestId" text,
    "sessionId" text,
    status public."AuditStatus" DEFAULT 'SUCCESS'::public."AuditStatus" NOT NULL
);


--
-- Name: bank_statement_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_statement_analyses (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "clientId" text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    provider text DEFAULT 'OBSE'::text NOT NULL,
    "statementDocumentIds" text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "payslipDocumentIds" text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "customerType" text NOT NULL,
    "referenceNumber" text,
    endpoint text NOT NULL,
    "httpStatus" integer,
    "durationMs" integer,
    "monthlyIncome" numeric(15,2),
    "monthlyExpenses" numeric(15,2),
    "disposableIncome" numeric(15,2),
    "suggestedRepayment" numeric(15,2),
    "primaryMonthlySalary" numeric(15,2),
    "incomeVolatility" text,
    "fraudFindingsCount" integer,
    "bankName" text,
    "statementFrom" text,
    "statementTo" text,
    "statementMonths" integer,
    "policyVersion" text,
    "rawResponse" jsonb,
    "errorMessage" text,
    "errorCode" text,
    "requestedById" text NOT NULL,
    "startedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "reviewerOverrides" jsonb,
    "adjustedAt" timestamp(3) without time zone,
    "adjustedById" text
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    address text,
    phone text,
    email text,
    "managerId" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: charge_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charge_rates (
    id text NOT NULL,
    "chargeId" text NOT NULL,
    amount numeric(15,2),
    percentage numeric(5,4),
    "minAmount" numeric(15,2),
    "maxAmount" numeric(15,2),
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    currency public."Currency" NOT NULL
);


--
-- Name: charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charges (
    id text NOT NULL,
    name text NOT NULL,
    type public."ChargeType" NOT NULL,
    "defaultAmount" numeric(15,2),
    description text,
    "isActive" boolean DEFAULT true NOT NULL,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "calculationType" public."ChargeCalculationType" DEFAULT 'FIXED'::public."ChargeCalculationType" NOT NULL,
    "appliesAt" public."ChargeAppliesAt" DEFAULT 'DISBURSEMENT'::public."ChargeAppliesAt" NOT NULL,
    "defaultPercentage" numeric(10,4),
    "isMandatory" boolean DEFAULT false NOT NULL,
    code text NOT NULL,
    "isDeductedFromPrincipal" boolean DEFAULT false NOT NULL,
    "createdBy" text,
    "updatedBy" text,
    "triggerStatus" public."LoanStatus",
    "chargeMode" public."ChargeMode" DEFAULT 'MANUAL'::public."ChargeMode" NOT NULL,
    "chargeApplication" public."ChargeApplication" DEFAULT 'PRINCIPAL'::public."ChargeApplication" NOT NULL
);


--
-- Name: client_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_addresses (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "addressType" public."AddressType" DEFAULT 'RESIDENTIAL'::public."AddressType" NOT NULL,
    "addressLine1" text NOT NULL,
    "addressLine2" text,
    suburb text,
    city text NOT NULL,
    state text,
    "zipCode" text,
    country text DEFAULT 'Zimbabwe'::text NOT NULL,
    latitude double precision,
    longitude double precision,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "isVerified" boolean DEFAULT false NOT NULL,
    "verifiedAt" timestamp(3) without time zone,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: client_businesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_businesses (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "businessName" text NOT NULL,
    "tradingName" text,
    "registrationNumber" text,
    "taxNumber" text,
    "vatNumber" text,
    "businessType" public."BusinessType" DEFAULT 'SOLE_PROPRIETOR'::public."BusinessType" NOT NULL,
    industry text,
    sector text,
    "yearEstablished" integer,
    "numberOfEmployees" integer,
    "monthlyTurnover" numeric(15,2),
    "annualRevenue" numeric(15,2),
    "businessAddress" text,
    "businessPhone" text,
    "businessEmail" text,
    website text,
    "bankName" text,
    "bankAccountNumber" text,
    "bankBranchCode" text,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: client_collaterals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_collaterals (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "collateralTypeId" text NOT NULL,
    description text NOT NULL,
    "estimatedValue" numeric(15,2) NOT NULL,
    currency public."Currency" DEFAULT 'USD'::public."Currency" NOT NULL,
    "valuationDate" timestamp(3) without time zone,
    valuator text,
    "registrationNumber" text,
    "serialNumber" text,
    make text,
    model text,
    year integer,
    location text,
    "ownershipStatus" public."OwnershipStatus" DEFAULT 'FULLY_OWNED'::public."OwnershipStatus" NOT NULL,
    "ownershipDetails" text,
    "insuranceProvider" text,
    "insurancePolicyNo" text,
    "insuranceExpiryDate" timestamp(3) without time zone,
    status public."CollateralStatus" DEFAULT 'AVAILABLE'::public."CollateralStatus" NOT NULL,
    "loanId" text,
    "pledgedAt" timestamp(3) without time zone,
    "releasedAt" timestamp(3) without time zone,
    notes text,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: client_communication_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_communication_preferences (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "clientId" text NOT NULL,
    "emailOptOut" boolean DEFAULT false NOT NULL,
    "smsOptOut" boolean DEFAULT false NOT NULL,
    "whatsappOptOut" boolean DEFAULT false NOT NULL,
    source text,
    note text,
    "updatedById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: client_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_contacts (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "contactType" public."ContactType" DEFAULT 'MOBILE'::public."ContactType" NOT NULL,
    "contactValue" text NOT NULL,
    label text,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "isWhatsApp" boolean DEFAULT false NOT NULL,
    "isVerified" boolean DEFAULT false NOT NULL,
    "verifiedAt" timestamp(3) without time zone,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: client_deletion_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_deletion_requests (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "clientId" text NOT NULL,
    "requestedById" text NOT NULL,
    reason text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    "reviewedById" text,
    "reviewedAt" timestamp(3) without time zone,
    "reviewNotes" text,
    "clientSnapshot" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: client_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_documents (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "documentTypeId" text NOT NULL,
    "fileName" text NOT NULL,
    "fileSize" integer NOT NULL,
    "mimeType" text NOT NULL,
    "storagePath" text NOT NULL,
    "storageUrl" text,
    "documentNumber" text,
    "issueDate" timestamp(3) without time zone,
    "expiryDate" timestamp(3) without time zone,
    "issuingAuthority" text,
    status public."DocumentStatus" DEFAULT 'PENDING'::public."DocumentStatus" NOT NULL,
    "rejectionReason" text,
    "aiExtractionData" jsonb,
    "aiConfidence" double precision,
    "extractedAt" timestamp(3) without time zone,
    "verifiedBy" text,
    "verifiedAt" timestamp(3) without time zone,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: client_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_drafts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL,
    "branchId" text,
    "draftData" jsonb NOT NULL,
    "requiredFieldsComplete" boolean DEFAULT false NOT NULL,
    "completionPercentage" integer DEFAULT 0 NOT NULL,
    "lastFieldUpdated" text,
    version integer DEFAULT 1 NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: client_employers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_employers (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "employerId" text NOT NULL,
    "position" text,
    salary numeric(15,2),
    "startDate" timestamp(3) without time zone,
    "endDate" timestamp(3) without time zone,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: client_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_limits (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "maxAmount" numeric(15,2) NOT NULL,
    currency public."Currency" DEFAULT 'USD'::public."Currency" NOT NULL,
    "usedAmount" numeric(15,2) DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "validFrom" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "validTo" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "availableBalance" numeric(15,2) NOT NULL,
    "enforceLimit" boolean DEFAULT false NOT NULL
);


--
-- Name: client_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_messages (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "clientId" text,
    "loanId" text,
    "broadcastId" text,
    channel text NOT NULL,
    provider text NOT NULL,
    direction text DEFAULT 'OUTBOUND'::text NOT NULL,
    "toAddress" text NOT NULL,
    "fromAddress" text,
    subject text,
    body text NOT NULL,
    "templateName" text,
    "templateLanguage" text,
    "templateParams" jsonb,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    "providerMessageId" text,
    "errorCode" text,
    "errorMessage" text,
    attempts integer DEFAULT 0 NOT NULL,
    "nextAttemptAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lockedAt" timestamp(3) without time zone,
    "sentById" text,
    "queuedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "sentAt" timestamp(3) without time zone,
    "deliveredAt" timestamp(3) without time zone,
    "readAt" timestamp(3) without time zone,
    "failedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id text NOT NULL,
    "clientNumber" text NOT NULL,
    type public."ClientType" DEFAULT 'INDIVIDUAL'::public."ClientType" NOT NULL,
    "firstName" text,
    "lastName" text,
    "businessName" text,
    email text,
    phone text NOT NULL,
    "dateOfBirth" timestamp(3) without time zone,
    gender text,
    "maritalStatus" text,
    "idNumber" text,
    address text,
    city text,
    state text,
    "zipCode" text,
    country text,
    "employmentStatus" text,
    "monthlyIncome" numeric(15,2),
    "creditScore" integer,
    "isActive" boolean DEFAULT true NOT NULL,
    "kycStatus" text DEFAULT 'PENDING'::text NOT NULL,
    "kycDocuments" jsonb,
    "profileImage" text,
    "thumbprintImage" text,
    "signatureImage" text,
    "organizationId" text NOT NULL,
    "branchId" text NOT NULL,
    "homeBranchId" text,
    "createdBy" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "idExpiryDate" timestamp(3) without time zone,
    "idIssueDate" timestamp(3) without time zone,
    "idType" text DEFAULT 'national_id'::text,
    "issuingAuthority" text,
    nationality text DEFAULT 'Zimbabwean'::text,
    "passportCountry" text,
    "passportNumber" text,
    "placeOfBirth" text,
    title text,
    "defaultGuarantorId" text
);


--
-- Name: collateral_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collateral_documents (
    id text NOT NULL,
    "collateralId" text NOT NULL,
    "fileName" text NOT NULL,
    "fileSize" integer NOT NULL,
    "mimeType" text NOT NULL,
    "storagePath" text NOT NULL,
    "documentType" text NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: collateral_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collateral_types (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    "isActive" boolean DEFAULT true NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "requiredFields" text[] DEFAULT ARRAY[]::text[],
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: currencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currencies (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    symbol text NOT NULL,
    "position" text DEFAULT 'before'::text NOT NULL,
    "decimalPlaces" integer DEFAULT 2 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdBy" text,
    "updatedBy" text
);


--
-- Name: document_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_types (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    "isRequired" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "validityDays" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: employers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employers (
    id text NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    email text,
    "contactPerson" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: entity_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_versions (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "entityType" text NOT NULL,
    "entityId" text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedBy" text
);


--
-- Name: exchange_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_rates (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "fromCurrency" public."Currency" NOT NULL,
    "toCurrency" public."Currency" NOT NULL,
    rate numeric(10,6) NOT NULL,
    "effectiveDate" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_categories (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    "isSystemCategory" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdBy" text
);


--
-- Name: financial_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_transactions (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "branchId" text,
    "transactionNumber" text NOT NULL,
    type public."FinancialTransactionType" NOT NULL,
    "incomeCategoryId" text,
    "expenseCategoryId" text,
    "paymentMethodId" text NOT NULL,
    amount numeric(15,2) NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    description text NOT NULL,
    reference text,
    "relatedLoanId" text,
    "relatedPaymentId" text,
    "transactionDate" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "balanceBefore" numeric(15,2) NOT NULL,
    "balanceAfter" numeric(15,2) NOT NULL,
    status public."FinancialTransactionStatus" DEFAULT 'COMPLETED'::public."FinancialTransactionStatus" NOT NULL,
    notes text,
    attachments jsonb,
    "processedBy" text NOT NULL,
    "approvedBy" text,
    "approvedAt" timestamp(3) without time zone,
    "voidedBy" text,
    "voidedAt" timestamp(3) without time zone,
    "voidReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_members (
    id text NOT NULL,
    "groupId" text NOT NULL,
    "clientId" text NOT NULL,
    role text DEFAULT 'MEMBER'::text NOT NULL,
    "joinedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "leftAt" timestamp(3) without time zone,
    "isActive" boolean DEFAULT true NOT NULL
);


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "groupNumber" text NOT NULL,
    "meetingDay" text,
    "meetingTime" text,
    "meetingPlace" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "organizationId" text NOT NULL,
    "branchId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: import_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_jobs (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "importType" public."ImportType" NOT NULL,
    "fileName" text NOT NULL,
    "originalFileName" text NOT NULL,
    "storagePath" text NOT NULL,
    status public."ImportStatus" DEFAULT 'PENDING'::public."ImportStatus" NOT NULL,
    "totalRows" integer,
    "processedRows" integer DEFAULT 0 NOT NULL,
    "successfulRows" integer DEFAULT 0 NOT NULL,
    "failedRows" integer DEFAULT 0 NOT NULL,
    "errorLog" jsonb,
    mapping jsonb,
    "createdBy" text NOT NULL,
    "startedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: income_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.income_categories (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    "isSystemCategory" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdBy" text
);


--
-- Name: loan_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_assessments (
    id text NOT NULL,
    "loanId" text NOT NULL,
    "assessorId" text NOT NULL,
    status text NOT NULL,
    "documentChecklist" jsonb,
    notes text,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "clientCharacter" text,
    "clientCapacity" text,
    "collateralQuality" text,
    conditions text,
    "capitalAdequacy" text,
    "recommendedAmount" numeric(15,2),
    recommendation text
);


--
-- Name: loan_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_categories (
    id text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    "isLongTerm" boolean DEFAULT false NOT NULL,
    "requiresBusinessVisit" boolean DEFAULT false NOT NULL,
    "requiresHomeVisit" boolean DEFAULT false NOT NULL,
    "requiresSecurityPledge" boolean DEFAULT false NOT NULL,
    "requiresCollateral" boolean DEFAULT false NOT NULL,
    "organizationId" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: loan_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_charges (
    id text NOT NULL,
    "loanId" text NOT NULL,
    "chargeId" text NOT NULL,
    amount numeric(15,2) NOT NULL,
    "paidAmount" numeric(15,2) DEFAULT 0 NOT NULL,
    status public."PaymentStatus" DEFAULT 'PENDING'::public."PaymentStatus" NOT NULL,
    "appliedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "paidAt" timestamp(3) without time zone,
    "financialTransactionId" text,
    "calculationType" public."ChargeCalculationType" NOT NULL,
    "baseAmount" numeric(15,2) NOT NULL,
    "chargeName" text NOT NULL,
    "chargeType" public."ChargeType" NOT NULL,
    "calculatedAmount" numeric(15,2) NOT NULL,
    "isDeductedFromPrincipal" boolean DEFAULT false NOT NULL,
    "isWaived" boolean DEFAULT false NOT NULL,
    "waivedBy" text,
    "waivedAt" timestamp(3) without time zone,
    "waiverReason" text,
    "appliedBy" text,
    currency public."Currency" NOT NULL
);


--
-- Name: loan_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_items (
    id text NOT NULL,
    "loanId" text NOT NULL,
    "shopProductId" text NOT NULL,
    quantity integer NOT NULL,
    "unitPrice" numeric(15,2) NOT NULL,
    "totalPrice" numeric(15,2) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: loan_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_products (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    type public."LoanType" DEFAULT 'SHORT_TERM'::public."LoanType" NOT NULL,
    "minAmount" numeric(15,2) NOT NULL,
    "maxAmount" numeric(15,2) NOT NULL,
    currency public."Currency" DEFAULT 'USD'::public."Currency" NOT NULL,
    "interestRate" numeric(5,2) NOT NULL,
    "calculationMethod" public."LoanCalculationMethod" DEFAULT 'REDUCING_BALANCE'::public."LoanCalculationMethod" NOT NULL,
    "minTerm" integer NOT NULL,
    "maxTerm" integer NOT NULL,
    "repaymentFrequency" public."RepaymentFrequency" DEFAULT 'MONTHLY'::public."RepaymentFrequency" NOT NULL,
    "gracePeriod" integer DEFAULT 0 NOT NULL,
    "penaltyRate" numeric(5,2) DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "requiresCollateral" boolean DEFAULT false NOT NULL,
    "requiresGuarantor" boolean DEFAULT false NOT NULL,
    "isOnlineEligible" boolean DEFAULT false NOT NULL,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "allowAutoCalculations" boolean DEFAULT true NOT NULL,
    "interestRateFrequency" public."RepaymentFrequency" DEFAULT 'ANNUAL'::public."RepaymentFrequency" NOT NULL,
    "createdById" text
);


--
-- Name: loan_purposes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_purposes (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    "isActive" boolean DEFAULT true NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "loanClass" public."LoanClass" DEFAULT 'CONSUMER'::public."LoanClass" NOT NULL
);


--
-- Name: loan_reversal_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_reversal_requests (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "loanId" text NOT NULL,
    "requestedById" text NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    "reviewedById" text,
    "reviewedAt" timestamp(3) without time zone,
    "reviewNotes" text,
    "reversalRecord" jsonb,
    "reversedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    kind text DEFAULT 'DISBURSEMENT'::text NOT NULL,
    "paymentId" text
);


--
-- Name: loan_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_visits (
    id text NOT NULL,
    "loanId" text NOT NULL,
    "visitType" public."VisitType" NOT NULL,
    address text,
    "gpsLat" numeric(10,8),
    "gpsLng" numeric(11,8),
    "visitedBy" text NOT NULL,
    "visitedAt" timestamp(3) without time zone,
    images text[],
    notes text,
    "syncedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: loan_workflow_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_workflow_history (
    id text NOT NULL,
    "loanId" text NOT NULL,
    "fromStatus" public."LoanStatus" NOT NULL,
    "toStatus" public."LoanStatus" NOT NULL,
    "changedBy" text NOT NULL,
    "changedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes text
);


--
-- Name: loans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loans (
    id text NOT NULL,
    "loanNumber" text NOT NULL,
    "clientId" text NOT NULL,
    "groupId" text,
    "productId" text NOT NULL,
    "organizationId" text NOT NULL,
    "branchId" text NOT NULL,
    "loanOfficerId" text NOT NULL,
    amount numeric(15,2) NOT NULL,
    currency public."Currency" DEFAULT 'USD'::public."Currency" NOT NULL,
    "interestRate" numeric(5,2) NOT NULL,
    "calculationMethod" public."LoanCalculationMethod" DEFAULT 'REDUCING_BALANCE'::public."LoanCalculationMethod" NOT NULL,
    term integer NOT NULL,
    "repaymentFrequency" public."RepaymentFrequency" NOT NULL,
    "installmentAmount" numeric(15,2) NOT NULL,
    "totalAmount" numeric(15,2) NOT NULL,
    "totalInterest" numeric(15,2) NOT NULL,
    status public."LoanStatus" DEFAULT 'PENDING'::public."LoanStatus" NOT NULL,
    "applicationDate" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "approvedDate" timestamp(3) without time zone,
    "disbursedDate" timestamp(3) without time zone,
    "maturityDate" timestamp(3) without time zone,
    "lastPaymentDate" timestamp(3) without time zone,
    "outstandingBalance" numeric(15,2) DEFAULT 0 NOT NULL,
    "principalBalance" numeric(15,2) DEFAULT 0 NOT NULL,
    "interestBalance" numeric(15,2) DEFAULT 0 NOT NULL,
    "penaltyBalance" numeric(15,2) DEFAULT 0 NOT NULL,
    purpose text,
    "collateralValue" numeric(15,2),
    "collateralDescription" text,
    "guarantorInfo" jsonb,
    notes text,
    "shopId" text,
    "applicationSource" public."ApplicationSource" DEFAULT 'BRANCH'::public."ApplicationSource" NOT NULL,
    "onlineApplicationId" text,
    "disbursementBranchId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "syncStatus" public."SyncStatus" DEFAULT 'SYNCED'::public."SyncStatus" NOT NULL,
    "syncVersion" integer DEFAULT 1 NOT NULL,
    "startDate" timestamp(3) without time zone,
    "expectedRepaymentDate" timestamp(3) without time zone,
    "nextDueDate" timestamp(3) without time zone,
    "interestAmount" numeric(15,2) DEFAULT 0 NOT NULL,
    "gracePeriodDays" integer DEFAULT 0 NOT NULL,
    "createdById" text,
    "disbursedById" text,
    "assignedDisburserId" text,
    "assignedAssessorId" text
);


--
-- Name: message_broadcasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_broadcasts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    channel text NOT NULL,
    subject text,
    body text NOT NULL,
    "templateName" text,
    "templateLanguage" text,
    "templateParams" jsonb,
    audience jsonb NOT NULL,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    "totalRecipients" integer DEFAULT 0 NOT NULL,
    "skippedCount" integer DEFAULT 0 NOT NULL,
    "createdById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "cancelledAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_templates (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    channel text DEFAULT 'ANY'::text NOT NULL,
    subject text,
    body text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: monthly_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_targets (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "branchId" text NOT NULL,
    currency public."Currency" NOT NULL,
    "targetType" public."TargetType" NOT NULL,
    "targetAmount" numeric(15,2) NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    notes text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdBy" text,
    "updatedBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: next_of_kins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.next_of_kins (
    id text NOT NULL,
    "clientId" text NOT NULL,
    name text NOT NULL,
    relationship text NOT NULL,
    phone text NOT NULL,
    email text,
    address text,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: note_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.note_attachments (
    id text NOT NULL,
    "noteId" text NOT NULL,
    "fileName" text NOT NULL,
    "fileSize" integer NOT NULL,
    "mimeType" text NOT NULL,
    "storagePath" text NOT NULL,
    "uploadedBy" text NOT NULL,
    "uploadedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: note_read_markers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.note_read_markers (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL,
    "entityType" public."NoteEntityType" NOT NULL,
    "entityId" text NOT NULL,
    "lastReadAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "entityType" public."NoteEntityType" NOT NULL,
    "entityId" text NOT NULL,
    content text NOT NULL,
    priority public."NotePriority" DEFAULT 'NORMAL'::public."NotePriority" NOT NULL,
    "isPinned" boolean DEFAULT false NOT NULL,
    "isPrivate" boolean DEFAULT false NOT NULL,
    "createdBy" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "editedAt" timestamp(3) without time zone,
    "deletedAt" timestamp(3) without time zone,
    "deletedBy" text
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "recipientId" text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    link text,
    resource text,
    "resourceId" text,
    "readAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: online_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.online_applications (
    id text NOT NULL,
    source public."ApplicationSource" NOT NULL,
    "applicationType" public."ApplicationType" NOT NULL,
    "clientPhone" text NOT NULL,
    "clientName" text,
    "idNumber" text,
    amount numeric(15,2) NOT NULL,
    "productId" text NOT NULL,
    "disbursementPreference" public."DisbursementPreference" NOT NULL,
    "bankAccount" text,
    "mobileNumber" text,
    "verificationCode" text,
    "verificationExpiry" timestamp(3) without time zone,
    status public."ApplicationStatus" DEFAULT 'PENDING'::public."ApplicationStatus" NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: organization_ai_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_ai_configs (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "aiProviderId" text NOT NULL,
    "apiKey" text,
    "modelName" text,
    "isEnabled" boolean DEFAULT true NOT NULL,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "maxTokens" integer,
    temperature double precision,
    settings jsonb,
    "usageThisMonth" integer DEFAULT 0 NOT NULL,
    "usageLimit" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: organization_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_settings (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "settingKey" text NOT NULL,
    "settingValue" jsonb NOT NULL,
    description text,
    "updatedBy" text,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id text NOT NULL,
    name text NOT NULL,
    type public."OrganizationType" DEFAULT 'MICROFINANCE'::public."OrganizationType" NOT NULL,
    address text,
    phone text,
    email text,
    website text,
    "registrationNumber" text,
    "licenseNumber" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "apiTier" public."ApiTier" DEFAULT 'BASIC'::public."ApiTier" NOT NULL,
    "apiKeysCount" integer DEFAULT 0 NOT NULL,
    "maxApiKeys" integer DEFAULT 1 NOT NULL,
    "rateLimit" integer DEFAULT 100 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    logo text
);


--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_methods (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    type public."PaymentMethodType" NOT NULL,
    "accountNumber" text,
    description text,
    "initialBalance" numeric(15,2) DEFAULT 0 NOT NULL,
    "currentBalance" numeric(15,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdBy" text,
    "updatedBy" text,
    "allowDisbursement" boolean DEFAULT true NOT NULL,
    "allowRepayment" boolean DEFAULT true NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id text NOT NULL,
    "paymentNumber" text NOT NULL,
    "loanId" text NOT NULL,
    amount numeric(15,2) NOT NULL,
    currency public."Currency" DEFAULT 'USD'::public."Currency" NOT NULL,
    "principalAmount" numeric(15,2) DEFAULT 0 NOT NULL,
    "interestAmount" numeric(15,2) DEFAULT 0 NOT NULL,
    "penaltyAmount" numeric(15,2) DEFAULT 0 NOT NULL,
    type public."TransactionType" DEFAULT 'LOAN_REPAYMENT'::public."TransactionType" NOT NULL,
    method text NOT NULL,
    status public."PaymentStatus" DEFAULT 'PENDING'::public."PaymentStatus" NOT NULL,
    "transactionRef" text,
    "gatewayResponse" jsonb,
    "paymentDate" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "receivedBy" text NOT NULL,
    notes text,
    "processedBranchId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "reversedAt" timestamp(3) without time zone,
    "reversedById" text,
    "reversalReason" text
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    module text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: product_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_charges (
    id text NOT NULL,
    "productId" text NOT NULL,
    "chargeId" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "isMandatory" boolean DEFAULT false NOT NULL,
    "customAmount" numeric(15,2),
    "customPercentage" numeric(5,4),
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id text NOT NULL,
    token text NOT NULL,
    "userId" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: repayment_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repayment_schedule (
    id text NOT NULL,
    "loanId" text NOT NULL,
    "installmentNumber" integer NOT NULL,
    "dueDate" timestamp(3) without time zone NOT NULL,
    "principalAmount" numeric(15,2) NOT NULL,
    "interestAmount" numeric(15,2) NOT NULL,
    "totalAmount" numeric(15,2) NOT NULL,
    "paidAmount" numeric(15,2) DEFAULT 0 NOT NULL,
    "outstandingAmount" numeric(15,2) NOT NULL,
    status public."PaymentStatus" DEFAULT 'PENDING'::public."PaymentStatus" NOT NULL,
    "paymentDate" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id text NOT NULL,
    "roleId" text NOT NULL,
    "permissionId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "organizationId" text,
    "isSystem" boolean DEFAULT false NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: security_pledges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_pledges (
    id text NOT NULL,
    "loanId" text NOT NULL,
    "itemDescription" text NOT NULL,
    "serialNumber" text,
    "estimatedValue" numeric(15,2) NOT NULL,
    currency public."Currency" DEFAULT 'USD'::public."Currency" NOT NULL,
    images text[],
    status text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: shop_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_products (
    id text NOT NULL,
    "shopId" text NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(15,2) NOT NULL,
    currency public."Currency" DEFAULT 'USD'::public."Currency" NOT NULL,
    sku text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shops (
    id text NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    "contactPerson" text,
    "bankAccount" text,
    "mobileNumber" text,
    "organizationId" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: sync_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_conflicts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "syncQueueId" text NOT NULL,
    "entityType" text NOT NULL,
    "entityId" text NOT NULL,
    "clientVersion" integer NOT NULL,
    "serverVersion" integer NOT NULL,
    "clientData" jsonb NOT NULL,
    "serverData" jsonb NOT NULL,
    resolution text,
    "resolvedBy" text,
    "resolvedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: sync_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_queue (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL,
    "deviceId" text,
    "entityType" text NOT NULL,
    "entityId" text NOT NULL,
    action public."SyncAction" NOT NULL,
    payload jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    status public."SyncStatus" DEFAULT 'PENDING'::public."SyncStatus" NOT NULL,
    error text,
    "retryCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "syncedAt" timestamp(3) without time zone,
    "processedAt" timestamp(3) without time zone
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id text NOT NULL,
    "settingKey" text NOT NULL,
    "settingValue" jsonb NOT NULL,
    description text,
    "updatedBy" text,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: user_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_branches (
    id text NOT NULL,
    "userId" text NOT NULL,
    "branchId" text NOT NULL,
    "isCurrent" boolean DEFAULT false NOT NULL,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "assignedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "assignedBy" text
);


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permissions (
    id text NOT NULL,
    "userId" text NOT NULL,
    "permissionCode" text NOT NULL,
    "grantedBy" text,
    "grantedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "isActive" boolean DEFAULT true NOT NULL
);


--
-- Name: user_role_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_role_assignments (
    id text NOT NULL,
    "userId" text NOT NULL,
    "roleId" text NOT NULL,
    "assignedBy" text,
    "assignedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "isActive" boolean DEFAULT true NOT NULL
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id text NOT NULL,
    "userId" text NOT NULL,
    token text NOT NULL,
    "deviceInfo" jsonb,
    "ipAddress" text,
    "userAgent" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "lastActivityAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    "firstName" text NOT NULL,
    "lastName" text NOT NULL,
    phone text,
    "dateOfBirth" timestamp(3) without time zone,
    avatar text,
    role public."UserRole" DEFAULT 'STAFF'::public."UserRole" NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "isEmailVerified" boolean DEFAULT false NOT NULL,
    "lastLoginAt" timestamp(3) without time zone,
    "organizationId" text,
    "branchId" text,
    permissions text[] DEFAULT ARRAY[]::text[],
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: ai_providers ai_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: assistant_api_connectors assistant_api_connectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_api_connectors
    ADD CONSTRAINT assistant_api_connectors_pkey PRIMARY KEY (id);


--
-- Name: assistant_approvals assistant_approvals_idempotencyKey_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_approvals
    ADD CONSTRAINT "assistant_approvals_idempotencyKey_key" UNIQUE ("idempotencyKey");


--
-- Name: assistant_approvals assistant_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_approvals
    ADD CONSTRAINT assistant_approvals_pkey PRIMARY KEY (id);


--
-- Name: assistant_artifacts assistant_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_artifacts
    ADD CONSTRAINT assistant_artifacts_pkey PRIMARY KEY (id);


--
-- Name: assistant_automation_runs assistant_automation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_automation_runs
    ADD CONSTRAINT assistant_automation_runs_pkey PRIMARY KEY (id);


--
-- Name: assistant_automations assistant_automations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_automations
    ADD CONSTRAINT assistant_automations_pkey PRIMARY KEY (id);


--
-- Name: assistant_browser_logins assistant_browser_logins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_browser_logins
    ADD CONSTRAINT assistant_browser_logins_pkey PRIMARY KEY (id);


--
-- Name: assistant_connections assistant_connections_composioUserId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_connections
    ADD CONSTRAINT "assistant_connections_composioUserId_key" UNIQUE ("composioUserId");


--
-- Name: assistant_connections assistant_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_connections
    ADD CONSTRAINT assistant_connections_pkey PRIMARY KEY (id);


--
-- Name: assistant_conversations assistant_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_conversations
    ADD CONSTRAINT assistant_conversations_pkey PRIMARY KEY (id);


--
-- Name: assistant_mcp_servers assistant_mcp_servers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_mcp_servers
    ADD CONSTRAINT assistant_mcp_servers_pkey PRIMARY KEY (id);


--
-- Name: assistant_memories assistant_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_memories
    ADD CONSTRAINT assistant_memories_pkey PRIMARY KEY (id);


--
-- Name: assistant_messages assistant_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_messages
    ADD CONSTRAINT assistant_messages_pkey PRIMARY KEY (id);


--
-- Name: assistant_outreach assistant_outreach_dedupeKey_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_outreach
    ADD CONSTRAINT "assistant_outreach_dedupeKey_key" UNIQUE ("dedupeKey");


--
-- Name: assistant_outreach assistant_outreach_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_outreach
    ADD CONSTRAINT assistant_outreach_pkey PRIMARY KEY (id);


--
-- Name: assistant_processed_emails assistant_processed_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_processed_emails
    ADD CONSTRAINT assistant_processed_emails_pkey PRIMARY KEY (id);


--
-- Name: assistant_run_steps assistant_run_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_run_steps
    ADD CONSTRAINT assistant_run_steps_pkey PRIMARY KEY (id);


--
-- Name: assistant_runs assistant_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_runs
    ADD CONSTRAINT assistant_runs_pkey PRIMARY KEY (id);


--
-- Name: assistant_settings assistant_settings_organizationId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_settings
    ADD CONSTRAINT "assistant_settings_organizationId_key" UNIQUE ("organizationId");


--
-- Name: assistant_settings assistant_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_settings
    ADD CONSTRAINT assistant_settings_pkey PRIMARY KEY (id);


--
-- Name: assistant_usage assistant_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_usage
    ADD CONSTRAINT assistant_usage_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bank_statement_analyses bank_statement_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_analyses
    ADD CONSTRAINT bank_statement_analyses_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: charge_rates charge_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_rates
    ADD CONSTRAINT charge_rates_pkey PRIMARY KEY (id);


--
-- Name: charges charges_organizationId_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT "charges_organizationId_code_key" UNIQUE ("organizationId", code);


--
-- Name: charges charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_pkey PRIMARY KEY (id);


--
-- Name: client_addresses client_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_addresses
    ADD CONSTRAINT client_addresses_pkey PRIMARY KEY (id);


--
-- Name: client_businesses client_businesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_businesses
    ADD CONSTRAINT client_businesses_pkey PRIMARY KEY (id);


--
-- Name: client_collaterals client_collaterals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_collaterals
    ADD CONSTRAINT client_collaterals_pkey PRIMARY KEY (id);


--
-- Name: client_communication_preferences client_communication_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_communication_preferences
    ADD CONSTRAINT client_communication_preferences_pkey PRIMARY KEY (id);


--
-- Name: client_contacts client_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_contacts
    ADD CONSTRAINT client_contacts_pkey PRIMARY KEY (id);


--
-- Name: client_deletion_requests client_deletion_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_deletion_requests
    ADD CONSTRAINT client_deletion_requests_pkey PRIMARY KEY (id);


--
-- Name: client_documents client_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_documents
    ADD CONSTRAINT client_documents_pkey PRIMARY KEY (id);


--
-- Name: client_drafts client_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_drafts
    ADD CONSTRAINT client_drafts_pkey PRIMARY KEY (id);


--
-- Name: client_employers client_employers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_employers
    ADD CONSTRAINT client_employers_pkey PRIMARY KEY (id);


--
-- Name: client_limits client_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_limits
    ADD CONSTRAINT client_limits_pkey PRIMARY KEY (id);


--
-- Name: client_messages client_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_messages
    ADD CONSTRAINT client_messages_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: collateral_documents collateral_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collateral_documents
    ADD CONSTRAINT collateral_documents_pkey PRIMARY KEY (id);


--
-- Name: collateral_types collateral_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collateral_types
    ADD CONSTRAINT collateral_types_pkey PRIMARY KEY (id);


--
-- Name: currencies currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_pkey PRIMARY KEY (id);


--
-- Name: document_types document_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_types
    ADD CONSTRAINT document_types_pkey PRIMARY KEY (id);


--
-- Name: employers employers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employers
    ADD CONSTRAINT employers_pkey PRIMARY KEY (id);


--
-- Name: entity_versions entity_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_versions
    ADD CONSTRAINT entity_versions_pkey PRIMARY KEY (id);


--
-- Name: exchange_rates exchange_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);


--
-- Name: financial_transactions financial_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_pkey PRIMARY KEY (id);


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: import_jobs import_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_pkey PRIMARY KEY (id);


--
-- Name: income_categories income_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income_categories
    ADD CONSTRAINT income_categories_pkey PRIMARY KEY (id);


--
-- Name: loan_assessments loan_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_assessments
    ADD CONSTRAINT loan_assessments_pkey PRIMARY KEY (id);


--
-- Name: loan_categories loan_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_categories
    ADD CONSTRAINT loan_categories_pkey PRIMARY KEY (id);


--
-- Name: loan_charges loan_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_charges
    ADD CONSTRAINT loan_charges_pkey PRIMARY KEY (id);


--
-- Name: loan_items loan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_items
    ADD CONSTRAINT loan_items_pkey PRIMARY KEY (id);


--
-- Name: loan_products loan_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_products
    ADD CONSTRAINT loan_products_pkey PRIMARY KEY (id);


--
-- Name: loan_purposes loan_purposes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_purposes
    ADD CONSTRAINT loan_purposes_pkey PRIMARY KEY (id);


--
-- Name: loan_reversal_requests loan_reversal_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_reversal_requests
    ADD CONSTRAINT loan_reversal_requests_pkey PRIMARY KEY (id);


--
-- Name: loan_visits loan_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_visits
    ADD CONSTRAINT loan_visits_pkey PRIMARY KEY (id);


--
-- Name: loan_workflow_history loan_workflow_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_workflow_history
    ADD CONSTRAINT loan_workflow_history_pkey PRIMARY KEY (id);


--
-- Name: loans loans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_pkey PRIMARY KEY (id);


--
-- Name: message_broadcasts message_broadcasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_broadcasts
    ADD CONSTRAINT message_broadcasts_pkey PRIMARY KEY (id);


--
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);


--
-- Name: monthly_targets monthly_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_targets
    ADD CONSTRAINT monthly_targets_pkey PRIMARY KEY (id);


--
-- Name: next_of_kins next_of_kins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.next_of_kins
    ADD CONSTRAINT next_of_kins_pkey PRIMARY KEY (id);


--
-- Name: note_attachments note_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_attachments
    ADD CONSTRAINT note_attachments_pkey PRIMARY KEY (id);


--
-- Name: note_read_markers note_read_markers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_read_markers
    ADD CONSTRAINT note_read_markers_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: online_applications online_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_applications
    ADD CONSTRAINT online_applications_pkey PRIMARY KEY (id);


--
-- Name: organization_ai_configs organization_ai_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_ai_configs
    ADD CONSTRAINT organization_ai_configs_pkey PRIMARY KEY (id);


--
-- Name: organization_settings organization_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT organization_settings_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: product_charges product_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_charges
    ADD CONSTRAINT product_charges_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: repayment_schedule repayment_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repayment_schedule
    ADD CONSTRAINT repayment_schedule_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: security_pledges security_pledges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_pledges
    ADD CONSTRAINT security_pledges_pkey PRIMARY KEY (id);


--
-- Name: shop_products shop_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_products
    ADD CONSTRAINT shop_products_pkey PRIMARY KEY (id);


--
-- Name: shops shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_pkey PRIMARY KEY (id);


--
-- Name: sync_conflicts sync_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_conflicts
    ADD CONSTRAINT sync_conflicts_pkey PRIMARY KEY (id);


--
-- Name: sync_queue sync_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_queue
    ADD CONSTRAINT sync_queue_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: user_branches user_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_role_assignments user_role_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ai_providers_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_providers_name_key ON public.ai_providers USING btree (name);


--
-- Name: api_keys_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX api_keys_key_key ON public.api_keys USING btree (key);


--
-- Name: assistant_api_connectors_org_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_api_connectors_org_enabled_idx ON public.assistant_api_connectors USING btree ("organizationId", enabled);


--
-- Name: assistant_approvals_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_approvals_org_status_idx ON public.assistant_approvals USING btree ("organizationId", status, "createdAt");


--
-- Name: assistant_approvals_runId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assistant_approvals_runId_idx" ON public.assistant_approvals USING btree ("runId");


--
-- Name: assistant_artifacts_conversationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assistant_artifacts_conversationId_idx" ON public.assistant_artifacts USING btree ("conversationId");


--
-- Name: assistant_artifacts_org_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assistant_artifacts_org_createdAt_idx" ON public.assistant_artifacts USING btree ("organizationId", "createdAt");


--
-- Name: assistant_automation_runs_automationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assistant_automation_runs_automationId_idx" ON public.assistant_automation_runs USING btree ("automationId", "startedAt");


--
-- Name: assistant_automation_runs_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_automation_runs_org_idx ON public.assistant_automation_runs USING btree ("organizationId", "startedAt");


--
-- Name: assistant_automations_enabled_nextRunAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assistant_automations_enabled_nextRunAt_idx" ON public.assistant_automations USING btree (enabled, "nextRunAt");


--
-- Name: assistant_automations_org_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_automations_org_type_idx ON public.assistant_automations USING btree ("organizationId", type);


--
-- Name: assistant_browser_logins_org_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_browser_logins_org_domain_idx ON public.assistant_browser_logins USING btree ("organizationId", domain);


--
-- Name: assistant_connections_org_toolkit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_connections_org_toolkit_idx ON public.assistant_connections USING btree ("organizationId", toolkit);


--
-- Name: assistant_conversations_org_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_conversations_org_client_idx ON public.assistant_conversations USING btree ("organizationId", "clientId", "lastMessageAt");


--
-- Name: assistant_conversations_org_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_conversations_org_user_idx ON public.assistant_conversations USING btree ("organizationId", "userId", "lastMessageAt");


--
-- Name: assistant_mcp_servers_org_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_mcp_servers_org_enabled_idx ON public.assistant_mcp_servers USING btree ("organizationId", enabled);


--
-- Name: assistant_memories_org_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_memories_org_scope_idx ON public.assistant_memories USING btree ("organizationId", scope);


--
-- Name: assistant_messages_conversationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assistant_messages_conversationId_createdAt_idx" ON public.assistant_messages USING btree ("conversationId", "createdAt");


--
-- Name: assistant_outreach_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_outreach_org_idx ON public.assistant_outreach USING btree ("organizationId", "createdAt");


--
-- Name: assistant_processed_emails_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_processed_emails_org_idx ON public.assistant_processed_emails USING btree ("organizationId", "createdAt");


--
-- Name: assistant_processed_emails_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assistant_processed_emails_unique ON public.assistant_processed_emails USING btree ("connectionId", purpose, "providerMessageId");


--
-- Name: assistant_run_steps_runId_index_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assistant_run_steps_runId_index_idx" ON public.assistant_run_steps USING btree ("runId", index);


--
-- Name: assistant_runs_conversationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assistant_runs_conversationId_createdAt_idx" ON public.assistant_runs USING btree ("conversationId", "createdAt");


--
-- Name: assistant_runs_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assistant_runs_organizationId_createdAt_idx" ON public.assistant_runs USING btree ("organizationId", "createdAt");


--
-- Name: assistant_runs_status_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assistant_runs_status_createdAt_idx" ON public.assistant_runs USING btree (status, "createdAt");


--
-- Name: assistant_usage_org_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_usage_org_day_idx ON public.assistant_usage USING btree ("organizationId", day);


--
-- Name: assistant_usage_org_day_model_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX assistant_usage_org_day_model_key ON public.assistant_usage USING btree ("organizationId", day, provider, model);


--
-- Name: audit_logs_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_action_idx ON public.audit_logs USING btree (action);


--
-- Name: audit_logs_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_organizationId_idx" ON public.audit_logs USING btree ("organizationId");


--
-- Name: audit_logs_requestId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_requestId_idx" ON public.audit_logs USING btree ("requestId");


--
-- Name: audit_logs_resourceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_resourceId_idx" ON public.audit_logs USING btree ("resourceId");


--
-- Name: audit_logs_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_resource_idx ON public.audit_logs USING btree (resource);


--
-- Name: audit_logs_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_timestamp_idx ON public.audit_logs USING btree ("timestamp");


--
-- Name: audit_logs_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_userId_idx" ON public.audit_logs USING btree ("userId");


--
-- Name: bank_statement_analyses_clientId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bank_statement_analyses_clientId_createdAt_idx" ON public.bank_statement_analyses USING btree ("clientId", "createdAt");


--
-- Name: bank_statement_analyses_organizationId_clientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bank_statement_analyses_organizationId_clientId_idx" ON public.bank_statement_analyses USING btree ("organizationId", "clientId");


--
-- Name: bank_statement_analyses_status_startedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bank_statement_analyses_status_startedAt_idx" ON public.bank_statement_analyses USING btree (status, "startedAt");


--
-- Name: branches_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX branches_code_key ON public.branches USING btree (code);


--
-- Name: branches_managerId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "branches_managerId_key" ON public.branches USING btree ("managerId");


--
-- Name: charge_rates_chargeId_currency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "charge_rates_chargeId_currency_key" ON public.charge_rates USING btree ("chargeId", currency);


--
-- Name: client_businesses_clientId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "client_businesses_clientId_key" ON public.client_businesses USING btree ("clientId");


--
-- Name: client_communication_preferences_clientId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "client_communication_preferences_clientId_key" ON public.client_communication_preferences USING btree ("clientId");


--
-- Name: client_deletion_requests_clientId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_deletion_requests_clientId_status_idx" ON public.client_deletion_requests USING btree ("clientId", status);


--
-- Name: client_deletion_requests_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_deletion_requests_organizationId_status_idx" ON public.client_deletion_requests USING btree ("organizationId", status);


--
-- Name: client_deletion_requests_requestedById_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_deletion_requests_requestedById_idx" ON public.client_deletion_requests USING btree ("requestedById");


--
-- Name: client_drafts_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_drafts_organizationId_idx" ON public.client_drafts USING btree ("organizationId");


--
-- Name: client_drafts_organizationId_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "client_drafts_organizationId_userId_key" ON public.client_drafts USING btree ("organizationId", "userId");


--
-- Name: client_drafts_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_drafts_updatedAt_idx" ON public.client_drafts USING btree ("updatedAt");


--
-- Name: client_drafts_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_drafts_userId_idx" ON public.client_drafts USING btree ("userId");


--
-- Name: client_employers_clientId_employerId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "client_employers_clientId_employerId_key" ON public.client_employers USING btree ("clientId", "employerId");


--
-- Name: client_messages_broadcastId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_messages_broadcastId_status_idx" ON public.client_messages USING btree ("broadcastId", status);


--
-- Name: client_messages_loanId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_messages_loanId_createdAt_idx" ON public.client_messages USING btree ("loanId", "createdAt");


--
-- Name: client_messages_organizationId_clientId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_messages_organizationId_clientId_createdAt_idx" ON public.client_messages USING btree ("organizationId", "clientId", "createdAt");


--
-- Name: client_messages_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_messages_organizationId_createdAt_idx" ON public.client_messages USING btree ("organizationId", "createdAt");


--
-- Name: client_messages_provider_providerMessageId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_messages_provider_providerMessageId_idx" ON public.client_messages USING btree (provider, "providerMessageId");


--
-- Name: client_messages_status_nextAttemptAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_messages_status_nextAttemptAt_idx" ON public.client_messages USING btree (status, "nextAttemptAt");


--
-- Name: clients_organizationId_clientNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "clients_organizationId_clientNumber_key" ON public.clients USING btree ("organizationId", "clientNumber");


--
-- Name: clients_organizationId_idNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "clients_organizationId_idNumber_key" ON public.clients USING btree ("organizationId", "idNumber");


--
-- Name: clients_organizationId_phone_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "clients_organizationId_phone_key" ON public.clients USING btree ("organizationId", phone);


--
-- Name: collateral_types_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "collateral_types_organizationId_code_key" ON public.collateral_types USING btree ("organizationId", code);


--
-- Name: currencies_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX currencies_code_key ON public.currencies USING btree (code);


--
-- Name: document_types_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "document_types_organizationId_code_key" ON public.document_types USING btree ("organizationId", code);


--
-- Name: entity_versions_organizationId_entityType_entityId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "entity_versions_organizationId_entityType_entityId_key" ON public.entity_versions USING btree ("organizationId", "entityType", "entityId");


--
-- Name: entity_versions_organizationId_entityType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "entity_versions_organizationId_entityType_idx" ON public.entity_versions USING btree ("organizationId", "entityType");


--
-- Name: entity_versions_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "entity_versions_updatedAt_idx" ON public.entity_versions USING btree ("updatedAt");


--
-- Name: expense_categories_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "expense_categories_organizationId_code_key" ON public.expense_categories USING btree ("organizationId", code);


--
-- Name: financial_transactions_organizationId_transactionDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "financial_transactions_organizationId_transactionDate_idx" ON public.financial_transactions USING btree ("organizationId", "transactionDate");


--
-- Name: financial_transactions_paymentMethodId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "financial_transactions_paymentMethodId_idx" ON public.financial_transactions USING btree ("paymentMethodId");


--
-- Name: financial_transactions_transactionNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "financial_transactions_transactionNumber_key" ON public.financial_transactions USING btree ("transactionNumber");


--
-- Name: group_members_groupId_clientId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "group_members_groupId_clientId_key" ON public.group_members USING btree ("groupId", "clientId");


--
-- Name: groups_groupNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "groups_groupNumber_key" ON public.groups USING btree ("groupNumber");


--
-- Name: income_categories_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "income_categories_organizationId_code_key" ON public.income_categories USING btree ("organizationId", code);


--
-- Name: loan_categories_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "loan_categories_organizationId_code_key" ON public.loan_categories USING btree ("organizationId", code);


--
-- Name: loan_purposes_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "loan_purposes_organizationId_code_key" ON public.loan_purposes USING btree ("organizationId", code);


--
-- Name: loan_reversal_requests_loanId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "loan_reversal_requests_loanId_status_idx" ON public.loan_reversal_requests USING btree ("loanId", status);


--
-- Name: loan_reversal_requests_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "loan_reversal_requests_organizationId_status_idx" ON public.loan_reversal_requests USING btree ("organizationId", status);


--
-- Name: loan_reversal_requests_paymentId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "loan_reversal_requests_paymentId_status_idx" ON public.loan_reversal_requests USING btree ("paymentId", status);


--
-- Name: loan_reversal_requests_requestedById_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "loan_reversal_requests_requestedById_idx" ON public.loan_reversal_requests USING btree ("requestedById");


--
-- Name: loans_assignedAssessorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "loans_assignedAssessorId_idx" ON public.loans USING btree ("assignedAssessorId");


--
-- Name: loans_assignedDisburserId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "loans_assignedDisburserId_idx" ON public.loans USING btree ("assignedDisburserId");


--
-- Name: loans_loanNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "loans_loanNumber_key" ON public.loans USING btree ("loanNumber");


--
-- Name: message_broadcasts_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "message_broadcasts_organizationId_createdAt_idx" ON public.message_broadcasts USING btree ("organizationId", "createdAt");


--
-- Name: message_templates_organizationId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "message_templates_organizationId_name_key" ON public.message_templates USING btree ("organizationId", name);


--
-- Name: monthly_targets_branchId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "monthly_targets_branchId_idx" ON public.monthly_targets USING btree ("branchId");


--
-- Name: monthly_targets_organizationId_branchId_currency_targetType_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "monthly_targets_organizationId_branchId_currency_targetType_key" ON public.monthly_targets USING btree ("organizationId", "branchId", currency, "targetType", year, month);


--
-- Name: monthly_targets_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "monthly_targets_organizationId_idx" ON public.monthly_targets USING btree ("organizationId");


--
-- Name: monthly_targets_year_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX monthly_targets_year_month_idx ON public.monthly_targets USING btree (year, month);


--
-- Name: note_attachments_noteId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "note_attachments_noteId_idx" ON public.note_attachments USING btree ("noteId");


--
-- Name: note_read_markers_organizationId_entityType_entityId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "note_read_markers_organizationId_entityType_entityId_idx" ON public.note_read_markers USING btree ("organizationId", "entityType", "entityId");


--
-- Name: note_read_markers_userId_entityType_entityId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "note_read_markers_userId_entityType_entityId_key" ON public.note_read_markers USING btree ("userId", "entityType", "entityId");


--
-- Name: notes_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notes_createdAt_idx" ON public.notes USING btree ("createdAt");


--
-- Name: notes_createdBy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notes_createdBy_idx" ON public.notes USING btree ("createdBy");


--
-- Name: notes_entityType_entityId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notes_entityType_entityId_idx" ON public.notes USING btree ("entityType", "entityId");


--
-- Name: notes_organizationId_entityType_entityId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notes_organizationId_entityType_entityId_createdAt_idx" ON public.notes USING btree ("organizationId", "entityType", "entityId", "createdAt");


--
-- Name: notes_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notes_organizationId_idx" ON public.notes USING btree ("organizationId");


--
-- Name: notifications_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_organizationId_createdAt_idx" ON public.notifications USING btree ("organizationId", "createdAt");


--
-- Name: notifications_recipientId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_recipientId_createdAt_idx" ON public.notifications USING btree ("recipientId", "createdAt");


--
-- Name: notifications_recipientId_readAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_recipientId_readAt_idx" ON public.notifications USING btree ("recipientId", "readAt");


--
-- Name: notifications_resource_resourceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_resource_resourceId_idx" ON public.notifications USING btree (resource, "resourceId");


--
-- Name: organization_ai_configs_organizationId_aiProviderId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organization_ai_configs_organizationId_aiProviderId_key" ON public.organization_ai_configs USING btree ("organizationId", "aiProviderId");


--
-- Name: organization_settings_organizationId_settingKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organization_settings_organizationId_settingKey_key" ON public.organization_settings USING btree ("organizationId", "settingKey");


--
-- Name: organizations_licenseNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organizations_licenseNumber_key" ON public.organizations USING btree ("licenseNumber");


--
-- Name: organizations_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organizations_name_key ON public.organizations USING btree (name);


--
-- Name: organizations_registrationNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organizations_registrationNumber_key" ON public.organizations USING btree ("registrationNumber");


--
-- Name: payment_methods_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "payment_methods_organizationId_code_key" ON public.payment_methods USING btree ("organizationId", code);


--
-- Name: payments_paymentNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "payments_paymentNumber_key" ON public.payments USING btree ("paymentNumber");


--
-- Name: payments_reversedById_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "payments_reversedById_idx" ON public.payments USING btree ("reversedById");


--
-- Name: permissions_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX permissions_code_idx ON public.permissions USING btree (code);


--
-- Name: permissions_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX permissions_code_key ON public.permissions USING btree (code);


--
-- Name: permissions_module_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX permissions_module_idx ON public.permissions USING btree (module);


--
-- Name: product_charges_productId_chargeId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "product_charges_productId_chargeId_key" ON public.product_charges USING btree ("productId", "chargeId");


--
-- Name: refresh_tokens_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX refresh_tokens_token_key ON public.refresh_tokens USING btree (token);


--
-- Name: repayment_schedule_loanId_installmentNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "repayment_schedule_loanId_installmentNumber_key" ON public.repayment_schedule USING btree ("loanId", "installmentNumber");


--
-- Name: role_permissions_roleId_permissionId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON public.role_permissions USING btree ("roleId", "permissionId");


--
-- Name: roles_name_organizationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "roles_name_organizationId_key" ON public.roles USING btree (name, "organizationId");


--
-- Name: roles_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "roles_organizationId_idx" ON public.roles USING btree ("organizationId");


--
-- Name: sync_conflicts_entityType_entityId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sync_conflicts_entityType_entityId_idx" ON public.sync_conflicts USING btree ("entityType", "entityId");


--
-- Name: sync_conflicts_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sync_conflicts_organizationId_idx" ON public.sync_conflicts USING btree ("organizationId");


--
-- Name: sync_conflicts_resolution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_conflicts_resolution_idx ON public.sync_conflicts USING btree (resolution);


--
-- Name: sync_queue_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sync_queue_createdAt_idx" ON public.sync_queue USING btree ("createdAt");


--
-- Name: sync_queue_entityType_entityId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sync_queue_entityType_entityId_idx" ON public.sync_queue USING btree ("entityType", "entityId");


--
-- Name: sync_queue_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sync_queue_organizationId_idx" ON public.sync_queue USING btree ("organizationId");


--
-- Name: sync_queue_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_queue_status_idx ON public.sync_queue USING btree (status);


--
-- Name: sync_queue_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sync_queue_userId_idx" ON public.sync_queue USING btree ("userId");


--
-- Name: system_settings_settingKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "system_settings_settingKey_key" ON public.system_settings USING btree ("settingKey");


--
-- Name: user_branches_branchId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_branches_branchId_idx" ON public.user_branches USING btree ("branchId");


--
-- Name: user_branches_userId_branchId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "user_branches_userId_branchId_key" ON public.user_branches USING btree ("userId", "branchId");


--
-- Name: user_branches_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_branches_userId_idx" ON public.user_branches USING btree ("userId");


--
-- Name: user_permissions_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_permissions_userId_idx" ON public.user_permissions USING btree ("userId");


--
-- Name: user_permissions_userId_permissionCode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "user_permissions_userId_permissionCode_key" ON public.user_permissions USING btree ("userId", "permissionCode");


--
-- Name: user_role_assignments_roleId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_role_assignments_roleId_idx" ON public.user_role_assignments USING btree ("roleId");


--
-- Name: user_role_assignments_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_role_assignments_userId_idx" ON public.user_role_assignments USING btree ("userId");


--
-- Name: user_role_assignments_userId_roleId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "user_role_assignments_userId_roleId_key" ON public.user_role_assignments USING btree ("userId", "roleId");


--
-- Name: user_sessions_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_sessions_isActive_idx" ON public.user_sessions USING btree ("isActive");


--
-- Name: user_sessions_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_sessions_token_idx ON public.user_sessions USING btree (token);


--
-- Name: user_sessions_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_sessions_token_key ON public.user_sessions USING btree (token);


--
-- Name: user_sessions_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_sessions_userId_idx" ON public.user_sessions USING btree ("userId");


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: api_keys api_keys_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_api_connectors assistant_api_connectors_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_api_connectors
    ADD CONSTRAINT "assistant_api_connectors_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_api_connectors assistant_api_connectors_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_api_connectors
    ADD CONSTRAINT "assistant_api_connectors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_approvals assistant_approvals_decidedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_approvals
    ADD CONSTRAINT "assistant_approvals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_approvals assistant_approvals_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_approvals
    ADD CONSTRAINT "assistant_approvals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_approvals assistant_approvals_requestedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_approvals
    ADD CONSTRAINT "assistant_approvals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_approvals assistant_approvals_runId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_approvals
    ADD CONSTRAINT "assistant_approvals_runId_fkey" FOREIGN KEY ("runId") REFERENCES public.assistant_runs(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_artifacts assistant_artifacts_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_artifacts
    ADD CONSTRAINT "assistant_artifacts_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.assistant_conversations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_artifacts assistant_artifacts_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_artifacts
    ADD CONSTRAINT "assistant_artifacts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_artifacts assistant_artifacts_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_artifacts
    ADD CONSTRAINT "assistant_artifacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_automation_runs assistant_automation_runs_automationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_automation_runs
    ADD CONSTRAINT "assistant_automation_runs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES public.assistant_automations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_automation_runs assistant_automation_runs_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_automation_runs
    ADD CONSTRAINT "assistant_automation_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_automations assistant_automations_branchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_automations
    ADD CONSTRAINT "assistant_automations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_automations assistant_automations_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_automations
    ADD CONSTRAINT "assistant_automations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_automations assistant_automations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_automations
    ADD CONSTRAINT "assistant_automations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_automations assistant_automations_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_automations
    ADD CONSTRAINT "assistant_automations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: assistant_browser_logins assistant_browser_logins_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_browser_logins
    ADD CONSTRAINT "assistant_browser_logins_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_browser_logins assistant_browser_logins_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_browser_logins
    ADD CONSTRAINT "assistant_browser_logins_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_connections assistant_connections_connectedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_connections
    ADD CONSTRAINT "assistant_connections_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_connections assistant_connections_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_connections
    ADD CONSTRAINT "assistant_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_conversations assistant_conversations_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_conversations
    ADD CONSTRAINT "assistant_conversations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_conversations assistant_conversations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_conversations
    ADD CONSTRAINT "assistant_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_conversations assistant_conversations_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_conversations
    ADD CONSTRAINT "assistant_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_mcp_servers assistant_mcp_servers_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_mcp_servers
    ADD CONSTRAINT "assistant_mcp_servers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_mcp_servers assistant_mcp_servers_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_mcp_servers
    ADD CONSTRAINT "assistant_mcp_servers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_memories assistant_memories_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_memories
    ADD CONSTRAINT "assistant_memories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_memories assistant_memories_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_memories
    ADD CONSTRAINT "assistant_memories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_memories assistant_memories_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_memories
    ADD CONSTRAINT "assistant_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_messages assistant_messages_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_messages
    ADD CONSTRAINT "assistant_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.assistant_conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_outreach assistant_outreach_automationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_outreach
    ADD CONSTRAINT "assistant_outreach_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES public.assistant_automations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_outreach assistant_outreach_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_outreach
    ADD CONSTRAINT "assistant_outreach_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_outreach assistant_outreach_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_outreach
    ADD CONSTRAINT "assistant_outreach_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_outreach assistant_outreach_messageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_outreach
    ADD CONSTRAINT "assistant_outreach_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public.client_messages(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_outreach assistant_outreach_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_outreach
    ADD CONSTRAINT "assistant_outreach_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_processed_emails assistant_processed_emails_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_processed_emails
    ADD CONSTRAINT "assistant_processed_emails_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_processed_emails assistant_processed_emails_connectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_processed_emails
    ADD CONSTRAINT "assistant_processed_emails_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES public.assistant_connections(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_processed_emails assistant_processed_emails_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_processed_emails
    ADD CONSTRAINT "assistant_processed_emails_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_run_steps assistant_run_steps_runId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_run_steps
    ADD CONSTRAINT "assistant_run_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES public.assistant_runs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_runs assistant_runs_actingUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_runs
    ADD CONSTRAINT "assistant_runs_actingUserId_fkey" FOREIGN KEY ("actingUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_runs assistant_runs_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_runs
    ADD CONSTRAINT "assistant_runs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.assistant_conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_runs assistant_runs_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_runs
    ADD CONSTRAINT "assistant_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_settings assistant_settings_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_settings
    ADD CONSTRAINT "assistant_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_settings assistant_settings_updatedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_settings
    ADD CONSTRAINT "assistant_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: assistant_usage assistant_usage_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_usage
    ADD CONSTRAINT "assistant_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: bank_statement_analyses bank_statement_analyses_adjustedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_analyses
    ADD CONSTRAINT "bank_statement_analyses_adjustedById_fkey" FOREIGN KEY ("adjustedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: bank_statement_analyses bank_statement_analyses_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_analyses
    ADD CONSTRAINT "bank_statement_analyses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bank_statement_analyses bank_statement_analyses_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_analyses
    ADD CONSTRAINT "bank_statement_analyses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bank_statement_analyses bank_statement_analyses_requestedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_analyses
    ADD CONSTRAINT "bank_statement_analyses_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: branches branches_managerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT "branches_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: branches branches_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT "branches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: charge_rates charge_rates_chargeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_rates
    ADD CONSTRAINT "charge_rates_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES public.charges(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: charges charges_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charges
    ADD CONSTRAINT "charges_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: client_addresses client_addresses_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_addresses
    ADD CONSTRAINT "client_addresses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_businesses client_businesses_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_businesses
    ADD CONSTRAINT "client_businesses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_collaterals client_collaterals_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_collaterals
    ADD CONSTRAINT "client_collaterals_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_collaterals client_collaterals_collateralTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_collaterals
    ADD CONSTRAINT "client_collaterals_collateralTypeId_fkey" FOREIGN KEY ("collateralTypeId") REFERENCES public.collateral_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: client_collaterals client_collaterals_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_collaterals
    ADD CONSTRAINT "client_collaterals_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: client_communication_preferences client_communication_preferences_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_communication_preferences
    ADD CONSTRAINT "client_communication_preferences_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_communication_preferences client_communication_preferences_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_communication_preferences
    ADD CONSTRAINT "client_communication_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_contacts client_contacts_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_contacts
    ADD CONSTRAINT "client_contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_deletion_requests client_deletion_requests_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_deletion_requests
    ADD CONSTRAINT "client_deletion_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_deletion_requests client_deletion_requests_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_deletion_requests
    ADD CONSTRAINT "client_deletion_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_deletion_requests client_deletion_requests_requestedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_deletion_requests
    ADD CONSTRAINT "client_deletion_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: client_deletion_requests client_deletion_requests_reviewedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_deletion_requests
    ADD CONSTRAINT "client_deletion_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: client_documents client_documents_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_documents
    ADD CONSTRAINT "client_documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_documents client_documents_documentTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_documents
    ADD CONSTRAINT "client_documents_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES public.document_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: client_employers client_employers_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_employers
    ADD CONSTRAINT "client_employers_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_employers client_employers_employerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_employers
    ADD CONSTRAINT "client_employers_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES public.employers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: client_limits client_limits_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_limits
    ADD CONSTRAINT "client_limits_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_messages client_messages_broadcastId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_messages
    ADD CONSTRAINT "client_messages_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES public.message_broadcasts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: client_messages client_messages_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_messages
    ADD CONSTRAINT "client_messages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_messages client_messages_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_messages
    ADD CONSTRAINT "client_messages_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: client_messages client_messages_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_messages
    ADD CONSTRAINT "client_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_messages client_messages_sentById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_messages
    ADD CONSTRAINT "client_messages_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: clients clients_branchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT "clients_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: clients clients_createdBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT "clients_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: clients clients_defaultGuarantorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT "clients_defaultGuarantorId_fkey" FOREIGN KEY ("defaultGuarantorId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: clients clients_homeBranchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT "clients_homeBranchId_fkey" FOREIGN KEY ("homeBranchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: clients clients_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT "clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: collateral_documents collateral_documents_collateralId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collateral_documents
    ADD CONSTRAINT "collateral_documents_collateralId_fkey" FOREIGN KEY ("collateralId") REFERENCES public.client_collaterals(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: collateral_types collateral_types_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collateral_types
    ADD CONSTRAINT "collateral_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: document_types document_types_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_types
    ADD CONSTRAINT "document_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: exchange_rates exchange_rates_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT "exchange_rates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: expense_categories expense_categories_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT "expense_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: financial_transactions financial_transactions_approvedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT "financial_transactions_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: financial_transactions financial_transactions_branchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT "financial_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: financial_transactions financial_transactions_expenseCategoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT "financial_transactions_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES public.expense_categories(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: financial_transactions financial_transactions_incomeCategoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT "financial_transactions_incomeCategoryId_fkey" FOREIGN KEY ("incomeCategoryId") REFERENCES public.income_categories(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: financial_transactions financial_transactions_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT "financial_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: financial_transactions financial_transactions_paymentMethodId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT "financial_transactions_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES public.payment_methods(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_transactions financial_transactions_processedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT "financial_transactions_processedBy_fkey" FOREIGN KEY ("processedBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: financial_transactions financial_transactions_relatedLoanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT "financial_transactions_relatedLoanId_fkey" FOREIGN KEY ("relatedLoanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: financial_transactions financial_transactions_voidedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT "financial_transactions_voidedBy_fkey" FOREIGN KEY ("voidedBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: group_members group_members_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT "group_members_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: group_members group_members_groupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: import_jobs import_jobs_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT "import_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: income_categories income_categories_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income_categories
    ADD CONSTRAINT "income_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: loan_assessments loan_assessments_assessorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_assessments
    ADD CONSTRAINT "loan_assessments_assessorId_fkey" FOREIGN KEY ("assessorId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loan_assessments loan_assessments_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_assessments
    ADD CONSTRAINT "loan_assessments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: loan_categories loan_categories_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_categories
    ADD CONSTRAINT "loan_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loan_charges loan_charges_chargeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_charges
    ADD CONSTRAINT "loan_charges_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES public.charges(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loan_charges loan_charges_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_charges
    ADD CONSTRAINT "loan_charges_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: loan_items loan_items_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_items
    ADD CONSTRAINT "loan_items_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: loan_items loan_items_shopProductId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_items
    ADD CONSTRAINT "loan_items_shopProductId_fkey" FOREIGN KEY ("shopProductId") REFERENCES public.shop_products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loan_products loan_products_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_products
    ADD CONSTRAINT "loan_products_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: loan_products loan_products_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_products
    ADD CONSTRAINT "loan_products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loan_purposes loan_purposes_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_purposes
    ADD CONSTRAINT "loan_purposes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: loan_reversal_requests loan_reversal_requests_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_reversal_requests
    ADD CONSTRAINT "loan_reversal_requests_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: loan_reversal_requests loan_reversal_requests_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_reversal_requests
    ADD CONSTRAINT "loan_reversal_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: loan_reversal_requests loan_reversal_requests_paymentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_reversal_requests
    ADD CONSTRAINT "loan_reversal_requests_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES public.payments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: loan_reversal_requests loan_reversal_requests_requestedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_reversal_requests
    ADD CONSTRAINT "loan_reversal_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loan_reversal_requests loan_reversal_requests_reviewedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_reversal_requests
    ADD CONSTRAINT "loan_reversal_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: loan_visits loan_visits_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_visits
    ADD CONSTRAINT "loan_visits_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: loan_visits loan_visits_visitedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_visits
    ADD CONSTRAINT "loan_visits_visitedBy_fkey" FOREIGN KEY ("visitedBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loan_workflow_history loan_workflow_history_changedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_workflow_history
    ADD CONSTRAINT "loan_workflow_history_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loan_workflow_history loan_workflow_history_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_workflow_history
    ADD CONSTRAINT "loan_workflow_history_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: loans loans_assignedAssessorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_assignedAssessorId_fkey" FOREIGN KEY ("assignedAssessorId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: loans loans_assignedDisburserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_assignedDisburserId_fkey" FOREIGN KEY ("assignedDisburserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: loans loans_branchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loans loans_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loans loans_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: loans loans_disbursedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_disbursedById_fkey" FOREIGN KEY ("disbursedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: loans loans_disbursementBranchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_disbursementBranchId_fkey" FOREIGN KEY ("disbursementBranchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: loans loans_groupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: loans loans_loanOfficerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_loanOfficerId_fkey" FOREIGN KEY ("loanOfficerId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loans loans_onlineApplicationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_onlineApplicationId_fkey" FOREIGN KEY ("onlineApplicationId") REFERENCES public.online_applications(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: loans loans_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loans loans_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_productId_fkey" FOREIGN KEY ("productId") REFERENCES public.loan_products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: loans loans_shopId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT "loans_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES public.shops(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: message_broadcasts message_broadcasts_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_broadcasts
    ADD CONSTRAINT "message_broadcasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: message_broadcasts message_broadcasts_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_broadcasts
    ADD CONSTRAINT "message_broadcasts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: message_templates message_templates_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT "message_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: message_templates message_templates_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT "message_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: monthly_targets monthly_targets_branchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_targets
    ADD CONSTRAINT "monthly_targets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: monthly_targets monthly_targets_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_targets
    ADD CONSTRAINT "monthly_targets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: next_of_kins next_of_kins_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.next_of_kins
    ADD CONSTRAINT "next_of_kins_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: note_attachments note_attachments_noteId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.note_attachments
    ADD CONSTRAINT "note_attachments_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES public.notes(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notes notes_createdBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT "notes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: notifications notifications_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_recipientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: organization_ai_configs organization_ai_configs_aiProviderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_ai_configs
    ADD CONSTRAINT "organization_ai_configs_aiProviderId_fkey" FOREIGN KEY ("aiProviderId") REFERENCES public.ai_providers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: organization_ai_configs organization_ai_configs_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_ai_configs
    ADD CONSTRAINT "organization_ai_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: organization_settings organization_settings_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT "organization_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_methods payment_methods_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT "payment_methods_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payments payments_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payments payments_processedBranchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_processedBranchId_fkey" FOREIGN KEY ("processedBranchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payments payments_receivedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_receivedBy_fkey" FOREIGN KEY ("receivedBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payments payments_reversedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: product_charges product_charges_chargeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_charges
    ADD CONSTRAINT "product_charges_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES public.charges(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: product_charges product_charges_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_charges
    ADD CONSTRAINT "product_charges_productId_fkey" FOREIGN KEY ("productId") REFERENCES public.loan_products(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: repayment_schedule repayment_schedule_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repayment_schedule
    ADD CONSTRAINT "repayment_schedule_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_permissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES public.permissions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: roles roles_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT "roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: security_pledges security_pledges_loanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_pledges
    ADD CONSTRAINT "security_pledges_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES public.loans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: shop_products shop_products_shopId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_products
    ADD CONSTRAINT "shop_products_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES public.shops(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: shops shops_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT "shops_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: user_branches user_branches_branchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT "user_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_branches user_branches_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT "user_branches_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_role_assignments user_role_assignments_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT "user_role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_role_assignments user_role_assignments_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT "user_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: users users_branchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: users users_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

