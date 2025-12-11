# Loan Engine Documentation

## Overview

The Loan Engine is an automated system for processing loan calculations, status updates, and charge applications. It's inspired by the Django loan management system (`engine.py`, `loan_engine.py`, `disburse.py`) but designed to be configurable per organization.

## Key Features

1. **Configurable Calculation Types** - Organizations can choose their loan calculation method
2. **Grace Period Handling** - Automatic handling of grace periods before status changes
3. **Due Date Calculations** - Automatic calculation of next due dates based on product settings
4. **Interest Recalculation** - Automatic interest recalculation when loans become overdue
5. **Automatic Charge Application** - Charges applied automatically based on loan status

## Calculation Engine Types

The system supports multiple calculation engine types, configurable per organization:

| Type | Description |
|------|-------------|
| `SHORT_TERM` | Simple interest, period-based (original Django system). Best for short-term loans with fixed terms. |
| `LONG_TERM` | Amortized schedule with installments. Best for mortgage-style loans. |
| `REDUCING_BALANCE` | Interest calculated on reducing balance. |
| `FLAT_RATE` | Fixed interest for entire term. |
| `CUSTOM` | Organization-specific custom logic. |

## How It Works

### 1. Loan Disbursement

When a loan is disbursed, the engine:

```
1. Checks if approval is required (configurable)
2. Calculates interest: Interest = Principal × Interest Rate
3. Sets start date and expected repayment date
4. Applies automatic charges for "ACTIVE" status
5. Updates loan balances
```

### 2. Daily Processing (Short-Term Engine)

The short-term engine runs daily and processes loans as follows:

```python
For each active/default loan:
    1. Calculate target date = next_due_date + grace_period
    
    2. If current_date > target_date:
        
        a. Calculate final due date = start_date + max_period + grace_period
        
        b. If current_date > final_due_date:
            - Move loan to OVERDUE status
            - Apply overdue charges
        
        c. Else:
            - If loan is ACTIVE → move to DEFAULT
            - Update next_due_date += period
            - Recalculate interest on balance
            - Apply charges for current status
```

### 3. Status Flow

```
PENDING → APPROVED → ACTIVE → DEFAULT → OVERDUE → WRITTEN_OFF
                                ↑
                                └── (Can recover back to ACTIVE with payment)
```

## Configuration

### Organization Settings

Configure via the settings API or database:

| Setting | Default | Description |
|---------|---------|-------------|
| `loan_engine_type` | `SHORT_TERM` | Which calculation engine to use |
| `loan_approval_required` | `true` | Whether approval is required before disbursement |
| `loan_auto_process_enabled` | `true` | Whether engine should auto-process loans |
| `loan_default_grace_period_days` | `7` | Default grace period in days |
| `loan_overdue_notification_enabled` | `true` | Send notifications for overdue loans |
| `loan_due_date_reminder_days` | `3` | Days before due date to send reminders |
| `loan_interest_calculation_on_overdue` | `true` | Recalculate interest when overdue |

### Product Settings

Each loan product can have:

| Field | Description |
|-------|-------------|
| `durationUnit` | DAYS, WEEKS, MONTHS, YEARS |
| `minPeriod` | Minimum loan period in duration units |
| `maxPeriod` | Maximum loan period in duration units |
| `gracePeriodDays` | Grace period before penalties |
| `engineType` | Which engine type to use |
| `allowAutoCalculations` | Whether engine should process this product |

### Charge Configuration

Charges can be configured to apply automatically:

| Field | Description |
|-------|-------------|
| `chargeMode` | `MANUAL` or `AUTO` |
| `triggerStatus` | Which status triggers the charge (e.g., ACTIVE, DEFAULT, OVERDUE) |
| `chargeApplication` | Calculate based on `PRINCIPAL` or `BALANCE` |

## API Endpoints

### Run Engine

```bash
POST /api/v1/loan-engine/run
```

Request body:
```json
{
  "organizationId": "uuid", // Optional, uses authenticated user's org
  "dryRun": false           // If true, returns what would be processed without changes
}
```

### Get Statistics

```bash
GET /api/v1/loan-engine/statistics
```

Returns:
```json
{
  "totalActiveLoans": 150,
  "totalDefaultLoans": 25,
  "totalOverdueLoans": 10,
  "totalOutstandingBalance": 500000,
  "loansToProcess": 5
}
```

### Get Pending Loans

```bash
GET /api/v1/loan-engine/pending
```

### Get Overdue Loans

```bash
GET /api/v1/loan-engine/overdue
```

### Disburse Loan

```bash
POST /api/v1/loan-engine/loans/:loanId/disburse
```

Request body:
```json
{
  "paymentMethodId": "uuid",
  "disbursementDate": "2024-01-15T10:00:00Z",
  "notes": "Disbursement note"
}
```

### Get Loan Balance

```bash
GET /api/v1/loan-engine/loans/:loanId/balance
```

### Get Engine Settings

```bash
GET /api/v1/loan-engine/settings
```

## Running as a Cron Job

### Using the CLI

```bash
# Run all daily jobs
npx ts-node src/jobs/loan-engine.jobs.ts all

# Run only the engine
npx ts-node src/jobs/loan-engine.jobs.ts engine

# Run only reminders
npx ts-node src/jobs/loan-engine.jobs.ts reminders

# Run only overdue notifications
npx ts-node src/jobs/loan-engine.jobs.ts overdue

# Run daily summary
npx ts-node src/jobs/loan-engine.jobs.ts summary
```

### Using Crontab

```cron
# Run loan engine every day at midnight
0 0 * * * cd /path/to/microfinex-api && npx ts-node src/jobs/loan-engine.jobs.ts engine

# Run all daily jobs at 1 AM
0 1 * * * cd /path/to/microfinex-api && npx ts-node src/jobs/loan-engine.jobs.ts all
```

### Using Node-Cron (programmatic)

```typescript
import cron from 'node-cron';
import { runDailyJobs } from './src/jobs/loan-engine.jobs';

// Run every day at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily loan jobs...');
  await runDailyJobs();
});
```

## Database Schema Changes

The loan engine requires the following schema additions:

### Loan Table

```prisma
model Loan {
  // ... existing fields ...
  startDate             DateTime?
  expectedRepaymentDate DateTime?
  nextDueDate           DateTime?
  interestAmount        Decimal   @default(0)
  gracePeriodDays       Int       @default(0)
}
```

### LoanProduct Table

```prisma
model LoanProduct {
  // ... existing fields ...
  gracePeriodDays       Int       @default(0)
  durationUnit          DurationUnit @default(MONTHS)
  minPeriod             Int       @default(1)
  maxPeriod             Int       @default(12)
  engineType            LoanCalculationEngineType @default(SHORT_TERM)
  allowAutoCalculations Boolean   @default(true)
}
```

### Charge Table

```prisma
model Charge {
  // ... existing fields ...
  triggerStatus         LoanStatus?
  chargeMode            ChargeMode @default(MANUAL)
  chargeApplication     ChargeApplication @default(PRINCIPAL)
}
```

### New Enums

```prisma
enum LoanCalculationEngineType {
  SHORT_TERM
  LONG_TERM
  REDUCING_BALANCE
  FLAT_RATE
  CUSTOM
}

enum DurationUnit {
  DAYS
  WEEKS
  MONTHS
  YEARS
}

enum ChargeMode {
  MANUAL
  AUTO
}

enum ChargeApplication {
  PRINCIPAL
  BALANCE
  OTHER
}
```

## Migration

Run the migration:

```bash
# Apply the manual migration
psql -d your_database < prisma/migrations/manual/add_loan_engine_fields.sql

# Or use Prisma migrate
npx prisma migrate dev --name add_loan_engine_fields

# Seed the settings
npx ts-node scripts/seed-loan-engine-settings.ts
```

## Example: Setting Up for Your Organization

1. **Configure Organization Settings**

```bash
curl -X POST /api/v1/settings \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "settingKey": "loan_engine_type",
    "settingValue": "SHORT_TERM"
  }'
```

2. **Create a Loan Product with Engine Settings**

```bash
curl -X POST /api/v1/loan-products \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Quick Cash Loan",
    "minAmount": 100,
    "maxAmount": 1000,
    "interestRate": 0.10,
    "durationUnit": "WEEKS",
    "minPeriod": 1,
    "maxPeriod": 4,
    "gracePeriodDays": 3,
    "engineType": "SHORT_TERM",
    "allowAutoCalculations": true
  }'
```

3. **Create Auto Charges**

```bash
# Charge applied when loan becomes ACTIVE
curl -X POST /api/v1/charges \
  -d '{
    "name": "Processing Fee",
    "code": "PROC_FEE",
    "type": "FEE",
    "calculationType": "PERCENTAGE",
    "defaultPercentage": 0.02,
    "chargeMode": "AUTO",
    "triggerStatus": "ACTIVE",
    "chargeApplication": "PRINCIPAL"
  }'

# Charge applied when loan becomes DEFAULT
curl -X POST /api/v1/charges \
  -d '{
    "name": "Late Payment Fee",
    "code": "LATE_FEE",
    "type": "PENALTY",
    "calculationType": "FIXED",
    "defaultAmount": 50,
    "chargeMode": "AUTO",
    "triggerStatus": "DEFAULT",
    "chargeApplication": "BALANCE"
  }'
```

4. **Run the Engine**

```bash
curl -X POST /api/v1/loan-engine/run \
  -H "Authorization: Bearer $TOKEN"
```

## Comparison with Django System

| Django System | Microfinex API |
|---------------|----------------|
| `LoanStatus.allow_auto_calculations` | `LoanProduct.allowAutoCalculations` |
| `Charge.loan_status` | `Charge.triggerStatus` |
| `Charge.mode` | `Charge.chargeMode` |
| `Charge.charge_application` | `Charge.chargeApplication` |
| `Period.duration_unit` | `LoanProduct.durationUnit` |
| `BranchProduct.min_period` | `LoanProduct.minPeriod` |
| `BranchProduct.max_period` | `LoanProduct.maxPeriod` |
| `BranchProduct.grace_period_days` | `LoanProduct.gracePeriodDays` |
| `Loan.next_due_date` | `Loan.nextDueDate` |
| `Loan.expected_repayment_date` | `Loan.expectedRepaymentDate` |
| `Loan.start_date` | `Loan.startDate` |
| `Loan.interest_amount` | `Loan.interestAmount` |

## Support

For questions or issues, refer to:

1. API Documentation: `/api/v1/docs` (Swagger UI)
2. This documentation: `docs/LOAN_ENGINE.md`
3. Source code: `src/services/loan-engine.service.ts`
4. Jobs: `src/jobs/loan-engine.jobs.ts`
