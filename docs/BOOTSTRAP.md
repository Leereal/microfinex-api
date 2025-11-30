# 🚀 Microfinex System Bootstrap Guide

This guide explains how to set up your multi-tenant microfinance system with the first Super Admin and organizations.

## 🎯 **Architecture Overview**

Your system follows a **multi-tenant architecture** with:

- **Super Admins**: `organizationId = null` - Can see and manage ALL organizations
- **Organization Admins**: `organizationId = specific-org-id` - Can only manage their organization
- **Organization Isolation**: Built-in Row Level Security ensures data isolation

## 🛠️ **Bootstrap Options**

### Option 1: Interactive Bootstrap Script (Recommended)

The easiest way to bootstrap your system:

```bash
# Make sure your database is running and .env is configured
npm run bootstrap
```

This will:
✅ Create your first Super Admin (with `organizationId = null`)  
✅ Create your first organization  
✅ Set up default branch and loan products  
✅ Handle all Supabase authentication  
✅ Validate all inputs  

**What it does:**
1. **Creates Super Admin**: No organization restriction - can access everything
2. **Creates Organization**: Your first microfinance institution
3. **Creates Branch**: Default "Head Office" branch
4. **Creates Loan Products**: Sample business, personal, and agricultural loans
5. **Sets Permissions**: Full system access for Super Admin

### Option 2: SQL Bootstrap (Advanced Users)

If you prefer direct SQL control:

```bash
# Generate SQL commands
npm run bootstrap:sql
```

This generates SQL that you can:
- Review before executing
- Customize as needed
- Run in your database console
- Save for documentation

### Option 3: Manual API Creation (For Existing Super Admins)

If you already have a Super Admin, use the API:

```bash
# Login as Super Admin first
POST /api/v1/auth/login

# Then create organizations
POST /api/v1/organizations
```

## 🔑 **Super Admin Powers**

Super Admins (`organizationId = null`) can:

✅ **Create Organizations**: New microfinance institutions  
✅ **View All Data**: Access clients, loans, payments across ALL organizations  
✅ **Create Super Admins**: Promote other users to Super Admin  
✅ **System Management**: API keys, rate limits, system settings  
✅ **Cross-Organization Reports**: Global analytics and reporting  

## 🏢 **Organization Hierarchy**

```
Super Admin (organizationId = null)
├── Organization A
│   ├── Admin (organizationId = A)
│   ├── Managers, Staff, etc.
│   └── Clients, Loans, Payments
├── Organization B
│   ├── Admin (organizationId = B)
│   ├── Managers, Staff, etc.
│   └── Clients, Loans, Payments
└── Organization C
    ├── Admin (organizationId = C)
    ├── Managers, Staff, etc.
    └── Clients, Loans, Payments
```

## 🔒 **Security Model**

### Row Level Security (RLS)
- **Automatic Data Isolation**: Users only see their organization's data
- **Super Admin Override**: Super Admins bypass RLS with `organizationId = null`
- **JWT-Based**: Authentication tokens include organization context

### Permission System
```typescript
// Super Admin permissions
[
  'CREATE_ORGANIZATIONS',
  'MANAGE_USERS', 
  'VIEW_ALL_DATA',
  'SYSTEM_ADMIN',
  'API_MANAGEMENT'
]

// Organization Admin permissions
[
  'MANAGE_ORGANIZATION',
  'MANAGE_USERS_ORG',
  'VIEW_ORG_DATA',
  'MANAGE_CLIENTS',
  'MANAGE_LOANS'
]
```

## 📋 **Step-by-Step Setup**

### 1. Prepare Environment
```bash
# Ensure database is running
# Ensure .env file has correct Supabase credentials
# Run migrations if needed
npm run db:push
```

### 2. Run Bootstrap
```bash
npm run bootstrap
```

### 3. Follow Prompts
```
Super Admin Email: admin@yourcompany.com
Super Admin Password: ********
First Name: John
Last Name: Doe
Organization Name: Your Microfinance Ltd
Organization Type: MICROFINANCE
Organization Address: 123 Business St, City
Organization Phone: +1234567890
Organization Email: info@yourcompany.com
```

### 4. Verify Setup
```bash
# Check the logs for:
✅ Super Admin created: admin@yourcompany.com
✅ Organization created: Your Microfinance Ltd  
✅ Default branch created: Head Office
✅ Sample loan products created
```

### 5. First Login
Use your Postman collection or web interface:
```json
{
  "email": "admin@yourcompany.com",
  "password": "your-password"
}
```

You should receive a JWT token with:
```json
{
  "userId": "uuid",
  "email": "admin@yourcompany.com", 
  "role": "SUPER_ADMIN",
  "organizationId": null,  // 🔑 This is key!
  "permissions": ["CREATE_ORGANIZATIONS", "MANAGE_USERS", ...]
}
```

## 🎯 **Next Steps**

After bootstrap:

### 1. Create More Organizations
```bash
# Use Postman collection: "Create Organization (Super Admin)"
# Or via API: POST /api/v1/organizations
```

### 2. Create Organization Admins
```bash
# For each organization, create an admin with organizationId set
POST /api/v1/auth/register
{
  "email": "admin@org1.com",
  "role": "ADMIN", 
  "organizationId": "org1-uuid-here"
}
```

### 3. Configure Loan Products
```bash
# Customize loan products for each organization
PUT /api/v1/loan-products/{id}
```

### 4. Start Processing
```bash
# Begin adding clients, creating loans, processing payments
# Each organization works independently
```

## 🔧 **Troubleshooting**

### "System already bootstrapped"
```bash
# If you see this message, you already have a Super Admin
# You can create additional Super Admins or skip bootstrap
```

### "Supabase authentication failed"
```bash
# Check your .env file:
SUPABASE_URL=your-project-url
SUPABASE_ANON_KEY=your-anon-key  
SUPABASE_SERVICE_ROLE_KEY=your-service-key
```

### "Database connection failed" 
```bash
# Check your database connection:
DATABASE_URL=your-database-url
# Run: npm run db:push to ensure schema is updated
```

### "Permission denied"
```bash
# Ensure you're using the service role key for admin operations
# Regular anon key won't work for user creation
```

## 📚 **Additional Resources**

- **API Documentation**: `/api-docs` (Swagger UI)
- **Postman Collection**: Import the generated collection for full API testing
- **Database Schema**: Check `prisma/schema.prisma` for complete data model
- **RLS Policies**: See `SUPABASE_SETUP.md` for Row Level Security details

## 🎉 **Success Indicators**

Your system is properly bootstrapped when:

✅ Super Admin can login and see empty organizations list  
✅ Organization Admin can login and only see their organization  
✅ Clients/Loans are isolated by organization  
✅ API responses include proper organization context  
✅ Swagger docs are accessible at `/api-docs`  

---

**🔐 Remember**: The first Super Admin has god-mode access. Guard these credentials carefully and create organization-specific admins for day-to-day operations.