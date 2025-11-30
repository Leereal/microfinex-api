import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './index';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Microfinex API',
      version: '1.0.0',
      description:
        'Modern Microfinance Management System API - A comprehensive solution for microfinance institutions to manage clients, loans, payments, and reporting.',
      contact: {
        name: 'API Support',
        email: 'support@microfinex.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: `http://localhost:${config.port}/api/v1`,
        description: 'Development server',
      },
      {
        url: '/api/v1',
        description: 'Current server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token obtained from /auth/login endpoint',
        },
      },
      schemas: {
        // Common response schemas
        ApiResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Indicates if the request was successful',
            },
            message: {
              type: 'string',
              description: 'Response message',
            },
            data: {
              type: 'object',
              description: 'Response data',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Response timestamp',
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            message: {
              type: 'string',
              description: 'Error message',
            },
            error: {
              type: 'string',
              description: 'Error code',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        // Authentication schemas
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
              example: 'user@example.com',
            },
            password: {
              type: 'string',
              minLength: 6,
              description: 'User password',
              example: 'password123',
            },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Login successful' },
            data: {
              type: 'object',
              properties: {
                user: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    email: { type: 'string' },
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                    role: { type: 'string' },
                    organizationId: { type: 'string' },
                  },
                },
                tokens: {
                  type: 'object',
                  properties: {
                    access: { type: 'string' },
                    refresh: { type: 'string' },
                  },
                },
              },
            },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        // Client schemas
        Client: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phoneNumber: { type: 'string' },
            dateOfBirth: { type: 'string', format: 'date' },
            nationalId: { type: 'string' },
            address: { type: 'string' },
            kycStatus: {
              type: 'string',
              enum: ['PENDING', 'VERIFIED', 'REJECTED'],
              description: 'Know Your Customer verification status',
            },
            creditScore: { type: 'number', minimum: 0, maximum: 850 },
            organizationId: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateClientRequest: {
          type: 'object',
          required: ['firstName', 'lastName', 'email', 'phoneNumber'],
          properties: {
            firstName: { type: 'string', minLength: 1, example: 'John' },
            lastName: { type: 'string', minLength: 1, example: 'Doe' },
            email: {
              type: 'string',
              format: 'email',
              example: 'john.doe@example.com',
            },
            phoneNumber: { type: 'string', example: '+1234567890' },
            dateOfBirth: {
              type: 'string',
              format: 'date',
              example: '1990-01-01',
            },
            nationalId: { type: 'string', example: 'ID123456789' },
            address: { type: 'string', example: '123 Main St, City, Country' },
          },
        },
        // Loan schemas
        Loan: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            clientId: { type: 'string' },
            amount: { type: 'number', minimum: 0 },
            interestRate: { type: 'number', minimum: 0 },
            termMonths: { type: 'integer', minimum: 1 },
            status: {
              type: 'string',
              enum: [
                'PENDING',
                'APPROVED',
                'REJECTED',
                'DISBURSED',
                'ACTIVE',
                'COMPLETED',
                'DEFAULTED',
              ],
            },
            purpose: { type: 'string' },
            collateralValue: { type: 'number' },
            monthlyPayment: { type: 'number' },
            totalInterest: { type: 'number' },
            totalAmount: { type: 'number' },
            organizationId: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateLoanRequest: {
          type: 'object',
          required: [
            'clientId',
            'amount',
            'interestRate',
            'termMonths',
            'purpose',
          ],
          properties: {
            clientId: { type: 'string', example: 'client-uuid' },
            amount: { type: 'number', minimum: 100, example: 10000 },
            interestRate: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              example: 15.5,
            },
            termMonths: {
              type: 'integer',
              minimum: 1,
              maximum: 360,
              example: 12,
            },
            purpose: { type: 'string', example: 'Business expansion' },
            collateralValue: { type: 'number', minimum: 0, example: 15000 },
          },
        },
        // Payment schemas
        Payment: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            loanId: { type: 'string' },
            amount: { type: 'number', minimum: 0 },
            paymentMethod: {
              type: 'string',
              enum: ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHECK'],
            },
            status: {
              type: 'string',
              enum: ['PENDING', 'COMPLETED', 'FAILED', 'REVERSED'],
            },
            reference: { type: 'string' },
            paymentDate: { type: 'string', format: 'date-time' },
            organizationId: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        CreatePaymentRequest: {
          type: 'object',
          required: ['loanId', 'amount', 'paymentMethod'],
          properties: {
            loanId: { type: 'string', example: 'loan-uuid' },
            amount: { type: 'number', minimum: 0.01, example: 500 },
            paymentMethod: {
              type: 'string',
              enum: ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHECK'],
              example: 'BANK_TRANSFER',
            },
            reference: { type: 'string', example: 'TXN123456' },
            notes: { type: 'string', example: 'Monthly payment' },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization endpoints',
      },
      {
        name: 'Organizations',
        description: 'Organization management endpoints',
      },
      {
        name: 'Users',
        description: 'User management endpoints',
      },
      {
        name: 'Clients',
        description: 'Client management and KYC endpoints',
      },
      {
        name: 'Loans',
        description: 'Loan application and management endpoints',
      },
      {
        name: 'Payments',
        description: 'Payment processing and tracking endpoints',
      },
      {
        name: 'Groups',
        description: 'Client group management endpoints',
      },
      {
        name: 'Employers',
        description: 'Employer information management',
      },
      {
        name: 'Reports',
        description: 'Business reporting and analytics endpoints',
      },
      {
        name: 'System',
        description: 'System health and information endpoints',
      },
    ],
  },
  apis: ['./src/routes/*.ts', './src/routes/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
export default swaggerSpec;
