# API Versioning Guide

## Overview

The Microfinex API uses URI-based versioning with the format `/api/v{version}`. All API endpoints are prefixed with the version number to ensure backward compatibility and smooth migrations.

## Current Version

- **Current Version**: `v1`
- **Base URL**: `https://your-domain.com/api/v1`
- **Status**: Active

## Endpoint Structure

All API endpoints follow this pattern:

```
/api/{version}/{resource}
```

### Example Endpoints

#### Authentication

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/refresh`

#### Client Management

- `GET /api/v1/clients`
- `POST /api/v1/clients`
- `GET /api/v1/clients/:id`
- `PUT /api/v1/clients/:id`

#### Loan Management

- `GET /api/v1/loans`
- `POST /api/v1/loans`
- `POST /api/v1/loans/:id/approve`
- `POST /api/v1/loans/:id/disburse`

#### Payment Processing

- `GET /api/v1/payments`
- `POST /api/v1/payments`
- `GET /api/v1/payments/history/:loanId`

## Special Endpoints

### Version Information

- `GET /api/v1` - Returns API version information and available endpoints

### Health Checks

- `GET /health` - Unversioned health check (for load balancers)
- `GET /api/v1/health` - Versioned health check with detailed information

### Root Information

- `GET /` - Returns basic API information and version details

## Version Detection

The API version is determined from the URL path. The system:

1. Extracts the version from the URL path (`/api/v1/...`)
2. Validates that the version is supported
3. Routes the request to the appropriate version handlers

## Error Responses

### Unsupported Version

```json
{
  "success": false,
  "error": "UNSUPPORTED_API_VERSION",
  "message": "API version 'v2' is not supported",
  "supported_versions": ["v1"],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Response Format

All API responses include version information in headers and/or response body:

```json
{
  "success": true,
  "data": { ... },
  "version": "v1",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Migration Strategy

When new versions are released:

1. **Backward Compatibility**: Previous versions remain functional
2. **Deprecation Notice**: Old versions get deprecation warnings
3. **Migration Period**: Sufficient time for clients to upgrade
4. **Version Sunset**: Old versions eventually disabled

## Future Versions

The system is designed to easily support multiple versions:

```typescript
// Future version support
export const API_VERSIONS = {
  V1: 'v1',
  V2: 'v2', // Future version
} as const;
```

## Client Implementation

### JavaScript/TypeScript

```javascript
const baseURL = 'https://your-api.com/api/v1';

// All requests go to versioned endpoints
const response = await fetch(`${baseURL}/clients`);
```

### cURL Examples

```bash
# Get all clients
curl -X GET "https://your-api.com/api/v1/clients" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Create a new client
curl -X POST "https://your-api.com/api/v1/clients" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name": "John Doe", "email": "john@example.com"}'
```

## Best Practices

1. **Always Use Versioned URLs**: Never rely on unversioned endpoints
2. **Handle Version Errors**: Implement proper error handling for unsupported versions
3. **Monitor Deprecations**: Watch for deprecation notices in responses
4. **Plan Migrations**: Allow time for version upgrades in your development cycle

## Testing

Test your API integration with version-specific endpoints:

```bash
# Test version information
curl -X GET "https://your-api.com/api/v1"

# Test health endpoint
curl -X GET "https://your-api.com/api/v1/health"
```

## Support

For questions about API versioning or migration assistance:

- Check the API documentation
- Review version-specific release notes
- Contact support for migration guidance
