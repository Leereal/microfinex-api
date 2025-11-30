#!/usr/bin/env node

/**
 * API Versioning Test Script
 *
 * This script tests the versioned API endpoints to ensure they're working correctly.
 */

const http = require('http');

const BASE_URL = 'http://localhost:8000';

// Test endpoints
const endpoints = [
  '/', // Root endpoint
  '/health', // Unversioned health
  '/api/health', // Versioned health (unversioned route)
  '/api/v1', // Version info
  '/api/v1/health', // Versioned health
];

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${path}`, res => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            path,
            status: res.statusCode,
            data: json,
          });
        } catch (error) {
          resolve({
            path,
            status: res.statusCode,
            data: data,
            error: 'Invalid JSON response',
          });
        }
      });
    });

    req.on('error', error => {
      reject({
        path,
        error: error.message,
      });
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject({
        path,
        error: 'Request timeout',
      });
    });
  });
}

async function testEndpoints() {
  console.log('🧪 Testing API Versioning Endpoints...\n');

  for (const endpoint of endpoints) {
    try {
      const result = await makeRequest(endpoint);
      console.log(`✅ ${endpoint}`);
      console.log(`   Status: ${result.status}`);

      if (result.data && typeof result.data === 'object') {
        if (result.data.version || result.data.api_version) {
          console.log(
            `   Version: ${result.data.version || result.data.api_version}`
          );
        }
        if (result.data.name) {
          console.log(`   Name: ${result.data.name}`);
        }
        if (result.data.endpoints) {
          console.log(
            `   Available Endpoints: ${Object.keys(result.data.endpoints).length}`
          );
        }
      }
      console.log('');
    } catch (error) {
      console.log(`❌ ${endpoint}`);
      console.log(`   Error: ${error.error}`);
      console.log('');
    }
  }

  console.log('🎯 Versioning Test Summary:');
  console.log('   • All endpoints should respond with version information');
  console.log('   • /api/v1 should show available endpoints');
  console.log(
    '   • Health endpoints should be accessible both versioned and unversioned'
  );
  console.log('   • Root endpoint should show API overview with version info');
}

// Run tests
testEndpoints().catch(console.error);
