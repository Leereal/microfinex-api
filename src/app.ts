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
import { initAuditContext, auditLogger } from './middleware/audit';

const app = express();

/**
 * How many reverse proxies sit in front of this process.
 *
 * Deployed behind Traefik (Coolify) or any other proxy, every request arrives
 * from the proxy's address. Without this, `req.ip` is that one address for
 * the entire internet, so the rate limiter buckets all callers together and
 * starts answering 429 to everybody once any one of them is busy - and the
 * audit log records the proxy rather than the client for every action.
 *
 * This is a hop count, not `true`, on purpose. Trusting every hop lets a
 * caller put whatever it likes at the front of X-Forwarded-For and so choose
 * its own rate-limit bucket. Set TRUST_PROXY to the number of proxies you
 * actually run; 0 disables it for a process exposed directly.
 */
const trustProxy = Number.parseInt(process.env.TRUST_PROXY ?? '', 10);
app.set(
  'trust proxy',
  Number.isNaN(trustProxy) ? (config.nodeEnv === 'production' ? 1 : 0) : trustProxy
);

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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-skip-cache',
    ],
    exposedHeaders: ['Content-Type', 'Content-Length'],
  })
);

// Compression middleware
app.use(compression());

// Body parsing middleware
/** Meta signs the exact bytes it sent, so the WhatsApp webhook needs them unparsed. */
export const WHATSAPP_WEBHOOK_PATH = '/api/v1/public/communications/whatsapp/webhook';

app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      if ((req as { originalUrl?: string }).originalUrl?.startsWith(WHATSAPP_WEBHOOK_PATH)) {
        (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      }
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use(rateLimiter);

// Request logging
app.use(requestLogger);

// Audit logging middleware - Initialize context for all requests
app.use(initAuditContext);
app.use(auditLogger);

// API routes
app.use('/api', routes);

// Swagger Documentation
const swaggerOptions = {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: `${process.env.API_TITLE || 'MicroSteward API'} Documentation`,
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
