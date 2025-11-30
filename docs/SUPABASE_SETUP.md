# Supabase Integration Guide

## Overview

This microfinance system uses Supabase as both the authentication provider AND the database provider, creating a unified, scalable solution.

## Setup Instructions

### 1. Create a Supabase Project

1. Go to https://supabase.com
2. Create a new project
3. Wait for the database to be provisioned

### 2. Get Your Credentials

From your Supabase dashboard, get:

- **Project URL**: `https://[YOUR-PROJECT-REF].supabase.co`
- **Anon Key**: Found in Settings > API
- **Service Role Key**: Found in Settings > API (keep secret!)
- **Database URL**: Found in Settings > Database

### 3. Update Environment Variables

Replace the placeholders in `.env`:

```env
# Supabase Database URL (from Settings > Database)
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"

# Supabase Authentication (from Settings > API)
SUPABASE_URL="https://[YOUR-PROJECT-REF].supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 4. Run Database Migrations

```bash
npx prisma db push
```

### 5. Seed the Database (Optional)

```bash
npx prisma db seed
```

## Architecture Benefits

### Unified Data Layer

- Single database instance for all data
- Automatic backups and scaling
- Built-in real-time subscriptions
- Row Level Security (RLS) support

### Authentication Integration

- Supabase handles user authentication
- JWT tokens automatically validated
- Built-in email verification
- Social login support available

### Security Features

- Row Level Security policies
- API rate limiting
- Automatic SSL encryption
- Audit logging capabilities

## Database Schema

The system creates these main tables in your Supabase database:

### Core Tables

- `users` - Extended user profiles (linked to Supabase auth.users)
- `organizations` - Microfinance institutions
- `branches` - Organization branches
- `clients` - Loan applicants/borrowers
- `loan_products` - Configurable loan products
- `loans` - Individual loan records
- `payments` - Payment transactions
- `repayment_schedule` - Payment schedules

### Supporting Tables

- `groups` - Client groups for group lending
- `charges` - Fees and charges
- `api_keys` - API access management
- `audit_logs` - System activity tracking

## Row Level Security (RLS)

Enable RLS policies to ensure data isolation between organizations:

```sql
-- Example RLS policy for loans table
CREATE POLICY "Users can only access loans from their organization"
ON loans FOR ALL
USING (organization_id IN (
  SELECT organization_id FROM users WHERE id = auth.uid()
));
```

## Real-time Features

Supabase provides real-time capabilities for:

- Live loan status updates
- Payment notifications
- Dashboard metrics
- User activity monitoring

## API Integration

The system provides both:

1. **REST API** - Traditional HTTP endpoints
2. **Supabase Client** - Direct database access with RLS
3. **Real-time subscriptions** - Live data updates

## Next Steps

1. Set up your Supabase project
2. Update the environment variables
3. Run the migrations
4. Test the authentication endpoints
5. Explore the loan calculation system

## Support

For Supabase-specific issues:

- Supabase Documentation: https://supabase.com/docs
- Supabase Community: https://github.com/supabase/supabase/discussions

For application-specific issues:

- Check the API documentation at `/api-docs`
- Review the loan calculation demos at `/api/v1/loan-demos/demo-calculations`
