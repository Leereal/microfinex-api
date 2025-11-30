import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { swaggerSpec } from './config/swagger';
import { securityHeaders, rateLimiter } from './utils/security';
import routes from './routes';
import { errorHandler } from './middleware/error';
import { requestLogger } from './middleware/logging';

const app = express();

// Security middleware
app.use(helmet());
app.use(securityHeaders);

// CORS configuration
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use(rateLimiter);

// Request logging
app.use(requestLogger);

// API routes
app.use('/api', routes);

// Swagger Documentation
const swaggerOptions = {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Microfinex API Documentation',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
  },
};

// Setup Swagger UI with type assertion to bypass compatibility issues
app.use('/api-docs', swaggerUi.serve as any);
app.get('/api-docs', swaggerUi.setup(swaggerSpec, swaggerOptions) as any);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: config.api.title,
    version: config.api.version,
    description: config.api.description,
    status: 'healthy',
    api_version: 'v1',
    endpoints: {
      api: '/api/v1',
      health: '/health',
      docs: '/api/docs',
    },
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: config.api.version,
    environment: config.nodeEnv,
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    error: 'NOT_FOUND',
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.use(errorHandler);

export default app;
