# 🚀 Microfinance System with Supabase Integration

## Overview

This is a **modern, comprehensive microfinance management system** that leverages **Supabase** as both the authentication provider and database. The system provides:

- ✅ **Unified Supabase Integration** - Single platform for auth and data
- ✅ **Flexible Loan Calculations** - Multiple calculation methods with real-time comparisons
- ✅ **Advanced Security** - Row Level Security, API keys, role-based access
- ✅ **Real-time Features** - Live updates, notifications, dashboard metrics
- ✅ **Scalable Architecture** - Modern Node.js/TypeScript/Express stack

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Server    │    │   Supabase      │
│                 │    │                 │    │                 │
│ - React/Vue/    │◄──►│ - Node.js       │◄──►│ - PostgreSQL    │
│   Angular       │    │ - TypeScript    │    │ - Auth Service  │
│ - Real-time UI  │    │ - Express.js    │    │ - Real-time API │
│                 │    │ - Loan Engine   │    │ - Storage       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📊 Key Features

### 🏦 Loan Management

- **Multiple Calculation Methods**: Reducing Balance, Flat Rate, Simple Interest, Compound Interest
- **Flexible Terms**: Daily to annual repayment frequencies
- **Advanced Features**: Grace periods, fees, penalties, early settlement
- **Real-time Comparisons**: Compare different calculation methods instantly

### 👥 Client Management

- **Comprehensive Profiles**: KYC, documents, credit scoring
- **Group Lending**: Support for solidarity groups
- **Relationship Management**: Track client interactions and history

### 💰 Payment Processing

- **Multiple Methods**: Cash, bank transfer, mobile money, cards
- **Automated Schedules**: Generate and track repayment schedules
- **Collections Management**: Arrears tracking, restructuring, write-offs

### 📈 Reporting & Analytics

- **Dashboard Metrics**: Portfolio analysis, performance indicators
- **Financial Reports**: Income statements, balance sheets, regulatory reports
- **Real-time Analytics**: Live updates on loan performance

## 🛠️ Technology Stack

### Backend

- **Node.js** + **TypeScript** - Type-safe server development
- **Express.js** - Web framework with comprehensive middleware
- **Prisma ORM** - Type-safe database access
- **Supabase** - Authentication and PostgreSQL database
- **Zod** - Runtime type validation
- **Jest** - Testing framework

### Development Tools

- **ESLint** + **Prettier** - Code quality and formatting
- **Husky** - Git hooks for code quality
- **tsx** - Fast TypeScript execution
- **Docker** - Containerization support

## 🚀 Quick Start

### 1. Prerequisites

```bash
# Node.js 18+ and npm
node --version  # Should be 18+
npm --version

# Git
git --version
```

### 2. Clone and Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd microfinex-api

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 3. Configure Supabase

#### Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Create a new project
3. Wait for database provisioning (~2 minutes)

#### Get Your Credentials

From your Supabase dashboard:

- **Settings > API**: Copy the URL and Keys
- **Settings > Database**: Copy the Connection String

#### Update .env File

```env
# Replace with your actual Supabase credentials
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"
SUPABASE_URL="https://[YOUR-PROJECT-REF].supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 4. Initialize Database

```bash
# Push schema to Supabase
npx prisma db push

# Generate Prisma client
npx prisma generate

# Optional: Seed sample data
npx prisma db seed
```

### 5. Start Development Server

```bash
# Start the API server
npm run dev

# Server will start on http://localhost:3000
```

## 🧪 Testing the System

### 1. Health Check

```bash
curl http://localhost:3000/api/health
```

### 2. Authentication Demo

```bash
# Register a new user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePass123!",
    "firstName": "Admin",
    "lastName": "User",
    "role": "SUPER_ADMIN"
  }'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePass123!"
  }'
```

### 3. Loan Calculation Demo

```bash
# View loan calculation demonstrations
curl http://localhost:3000/api/v1/loan-demos/demo-calculations

# Compare penalty calculations
curl http://localhost:3000/api/v1/loan-demos/demo-penalty
```

### 4. Interactive API Testing

Visit `http://localhost:3000/api-docs` for Swagger documentation and interactive testing.

## 💡 Loan Calculation Examples

### Example 1: Compare Calculation Methods

```json
{
  "principalAmount": 100000,
  "annualInterestRate": 12,
  "termInMonths": 24,
  "repaymentFrequency": "MONTHLY"
}
```

**Results:**

- **Reducing Balance**: $4,707.35/month, Total Interest: $12,976.49
- **Flat Rate**: $5,000.00/month, Total Interest: $24,000.00
- **Simple Interest**: $5,000.00/month, Total Interest: $24,000.00

### Example 2: Different Repayment Frequencies

```json
{
  "principalAmount": 50000,
  "annualInterestRate": 18,
  "termInMonths": 12,
  "repaymentFrequency": "WEEKLY"
}
```

## 🔐 Security Features

### Authentication

- **Supabase Auth**: Industry-standard JWT authentication
- **Password Security**: bcrypt hashing with salt
- **Session Management**: Automatic token refresh
- **Email Verification**: Built-in email verification flow

### Authorization

- **Role-Based Access**: Super Admin, Admin, Manager, Staff, Client
- **Organization Isolation**: Users can only access their organization's data
- **API Key Support**: Secure API access for integrations
- **Row Level Security**: Database-level security policies

### Data Protection

- **Input Validation**: Zod schema validation on all endpoints
- **SQL Injection Prevention**: Prisma ORM with parameterized queries
- **Rate Limiting**: Configurable request rate limits
- **CORS Protection**: Cross-origin request security
- **Helmet Security**: Security headers and protection

## 📊 Database Schema

### Core Tables

```sql
-- Organizations (Microfinance Institutions)
organizations (id, name, type, address, phone, email, settings)

-- Users (Staff and Admin Users)
users (id, email, first_name, last_name, role, organization_id, is_active)

-- Clients (Loan Applicants/Borrowers)
clients (id, first_name, last_name, phone, email, address, kyc_status, organization_id)

-- Loan Products (Configurable Products)
loan_products (id, name, min_amount, max_amount, interest_rate, calculation_method, terms)

-- Loans (Individual Loan Records)
loans (id, client_id, product_id, amount, interest_rate, calculation_method, status, disbursed_date)

-- Payments (Payment Transactions)
payments (id, loan_id, amount, principal_amount, interest_amount, payment_date, method)

-- Repayment Schedule (Payment Schedule)
repayment_schedule (id, loan_id, installment_number, due_date, principal_amount, interest_amount, status)
```

### Supporting Tables

- `branches` - Organization branches
- `groups` - Client groups for solidarity lending
- `charges` - Fees and charges configuration
- `api_keys` - API access management
- `audit_logs` - System activity tracking

## 🔄 Real-time Features

### Live Updates

```javascript
// Subscribe to loan updates
const subscription = supabase
  .channel('loan-updates')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'loans' },
    payload => {
      console.log('Loan updated:', payload);
      // Update UI in real-time
    }
  )
  .subscribe();
```

### Dashboard Metrics

Real-time portfolio metrics including:

- Active loans count and value
- Collection rates and arrears
- Disbursement trends
- Client acquisition metrics

## 🚀 Deployment

### Environment Setup

```bash
# Production environment variables
NODE_ENV=production
PORT=3000

# Supabase Production URLs
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres"
SUPABASE_URL="https://[PROJECT].supabase.co"
SUPABASE_ANON_KEY="[PRODUCTION_ANON_KEY]"
SUPABASE_SERVICE_ROLE_KEY="[PRODUCTION_SERVICE_KEY]"

# Security
JWT_SECRET="[SECURE_RANDOM_SECRET_256_BITS]"

# Email Configuration
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@domain.com"
SMTP_PASS="your-app-password"
```

### Docker Deployment

```bash
# Build Docker image
docker build -t microfinex-api .

# Run container
docker run -p 3000:3000 --env-file .env microfinex-api
```

### Cloud Deployment Options

- **Railway**: Simple deployment with Supabase integration
- **Vercel**: Serverless deployment for API routes
- **Railway + Supabase**: Complete managed solution
- **AWS/GCP/Azure**: Full control with container services

## 📚 API Documentation

### Available Endpoints

#### Authentication

- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/logout` - User logout
- `GET /api/v1/auth/me` - Get current user profile
- `POST /api/v1/auth/change-password` - Change password
- `POST /api/v1/auth/api-key` - Generate API key

#### Loan Calculations

- `POST /api/v1/loans/calculate` - Calculate loan with any method
- `POST /api/v1/loans/compare-methods` - Compare calculation methods
- `GET /api/v1/loans/methods` - Get available calculation methods
- `POST /api/v1/loans/{id}/calculate-penalty` - Calculate penalties

#### Loan Management

- `GET /api/v1/loans` - List loans with filtering
- `POST /api/v1/loans` - Create new loan
- `GET /api/v1/loans/{id}` - Get loan details
- `PUT /api/v1/loans/{id}` - Update loan
- `DELETE /api/v1/loans/{id}` - Delete loan

#### Demo & Testing

- `GET /api/v1/loan-demos/demo-calculations` - Interactive calculation demo
- `GET /api/v1/loan-demos/demo-penalty` - Penalty calculation examples

#### System

- `GET /api/health` - Health check
- `GET /api/v1/docs` - API documentation

## 🎯 Next Steps

### Immediate Tasks

1. Set up your Supabase project
2. Configure environment variables
3. Test the authentication flow
4. Explore the loan calculation demos

### Development Roadmap

1. **Client Management System** - Complete CRUD operations
2. **Loan Processing Workflow** - Application to disbursement
3. **Payment & Collection System** - Payment processing and tracking
4. **Reporting & Analytics** - Comprehensive business intelligence
5. **Mobile App Integration** - React Native or Flutter app
6. **Third-party Integrations** - Payment gateways, SMS services

## 🤝 Support

### Documentation

- **API Docs**: `http://localhost:3000/api-docs`
- **Supabase Docs**: [https://supabase.com/docs](https://supabase.com/docs)
- **Prisma Docs**: [https://www.prisma.io/docs](https://www.prisma.io/docs)

### Community

- **Supabase Community**: [GitHub Discussions](https://github.com/supabase/supabase/discussions)
- **Node.js Community**: [Official Website](https://nodejs.org/en/community/)

---

## 🎉 Congratulations!

You now have a **world-class microfinance management system** with:

- ✅ Modern architecture with Supabase integration
- ✅ Flexible loan calculation engine
- ✅ Enterprise-grade security
- ✅ Real-time capabilities
- ✅ Comprehensive API
- ✅ Scalable foundation

**Ready to transform microfinance operations!** 🚀
