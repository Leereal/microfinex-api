# Microfinex API v1 - Smart Collection

This is an enhanced Postman collection for the Microfinex API that provides **automatic variable population** and seamless authentication management.

## 🚀 Quick Start

1. **Import the Collection**: Import `Microfinex-API-v1-Smart-Collection.postman_collection.json` into Postman
2. **Login**: Use the "Login" request under "🔐 Authentication"
3. **Start Testing**: All other requests will automatically use the populated auth token

## ✨ Key Features

### 🔑 Automatic Token Management

- **Zero Manual Token Entry**: Login once, and all subsequent requests automatically use the JWT token
- **Smart Token Population**: The login request automatically extracts and stores the JWT token in collection variables
- **Token Expiration Warnings**: Get notified when your token is about to expire
- **Automatic Logout Cleanup**: Logout clears all stored tokens automatically

### 📊 Intelligent Variable Population

The collection automatically populates these variables from API responses:

- `authToken` - JWT access token (from login)
- `refreshToken` - Refresh token (from login/refresh)
- `userId` - Current user ID (from login)
- `organizationId` - Current organization ID (from login/organization creation)
- `clientId` - Last created/retrieved client ID
- `loanId` - Last created/retrieved loan ID
- `paymentId` - Last created/retrieved payment ID
- `groupId` - Last created/retrieved group ID
- `employerId` - Last created/retrieved employer ID

### 🛡️ Enhanced Security

- **Bearer Token Authentication**: Collection-level authentication automatically applied to all protected endpoints
- **No Auth on Public Endpoints**: Health and info endpoints don't require authentication
- **Super Admin Detection**: Automatically detects and handles Super Admin users (no organization restriction)

### 📝 Comprehensive Logging

- **Request/Response Timing**: See how long each request takes
- **Detailed Error Messages**: Clear error messages with suggestions
- **Success Confirmations**: Visual feedback for successful operations
- **Variable Updates**: See when variables are automatically updated

## 🔧 Configuration

### Base URL

The collection uses `http://localhost:8000/api/v1` by default. Update the `baseUrl` variable if your API runs on a different host/port.

### Default Credentials

The login request comes pre-configured with Super Admin credentials:

- **Email**: `leereal08@ymail.com`
- **Password**: `Mutabvuri$8`
- **Role**: `SUPER_ADMIN`

## 📋 How It Works

### Login Process

```
1. Send login request with email/password
2. ✅ Collection automatically extracts JWT token from response
3. ✅ Collection stores token in authToken variable
4. ✅ Collection sets user ID and organization ID
5. ✅ All subsequent requests automatically use the token
```

### Creating Resources

```
1. Use any "Create" request (Create Client, Create Organization, etc.)
2. ✅ Collection automatically extracts the new resource ID
3. ✅ Collection stores the ID in the appropriate variable (clientId, organizationId, etc.)
4. ✅ Other requests can now reference the created resource
```

## 🔗 Request Organization

The collection is organized into logical folders:

### 🔐 Authentication

- **Login** - Automatic token population
- **Register User** - Create new users
- **Refresh Token** - Refresh JWT tokens
- **Logout** - Clear all tokens

### 🏢 Organizations

- **Create Organization** - Super Admin only
- **List Organizations** - Auto-populate first organization ID

### 👥 Client Management

- **Create Client** - Auto-populate client ID
- **List Clients** - Auto-populate first client ID

### 🔧 System & Health

- **API Health Check** - No auth required
- **API Information** - No auth required

## 💡 Pro Tips

### 1. Watch the Console

All automatic variable updates and helpful information are logged to the Postman console. Open it via:
`View → Show Postman Console`

### 2. Variable Inspection

Check current variable values at any time:

- Click the collection name
- Go to the "Variables" tab
- See current values of all auto-populated variables

### 3. Token Expiration

The collection warns you when tokens are about to expire (< 5 minutes remaining). Use the "Refresh Token" request to get new tokens.

### 4. Super Admin vs Regular Users

- **Super Admin**: No organization restriction, can create organizations
- **Regular Users**: Tied to specific organization, see organization-specific data

### 5. Error Handling

Failed requests show detailed error information in the console, including:

- HTTP status codes
- Error messages from the API
- Suggestions for resolution

## 🐛 Troubleshooting

### "No auth token found" Warning

**Solution**: Run the Login request first. The warning appears for protected endpoints when no token is set.

### 401 Unauthorized Errors

**Solutions**:

1. Run the Login request to get a fresh token
2. Check if your token has expired (see console warnings)
3. Use the Refresh Token request if you have a valid refresh token

### Variables Not Updating

**Check**:

1. Request completed successfully (2xx status code)
2. Response contains expected data structure
3. Console for any error messages during variable extraction

### Wrong Organization Data

**For Multi-tenant Issues**:

1. Ensure you're logged in with the correct user
2. Check the `organizationId` variable matches your intended organization
3. Super Admins see all data; regular users see organization-specific data

## 🔄 Collection Updates

When the API changes:

1. Import the new collection version
2. Your existing variables will be preserved
3. New features and endpoints will be available automatically

## 📚 API Documentation

For complete API documentation with schema details and examples, visit:
`http://localhost:8000/api-docs`

The Swagger UI provides:

- Interactive API testing
- Complete request/response schemas
- Authentication examples
- Error code references

---

**Happy Testing! 🚀**

The Microfinex API Smart Collection makes API testing effortless with automatic token management and intelligent variable population.
