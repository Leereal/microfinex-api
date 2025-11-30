import app from './app';
import { config } from './config';
import { prisma } from './config/database';

const PORT = config.port;

/**
 * Start the server
 */
const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    // Start the server
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📖 Environment: ${config.nodeEnv}`);
      console.log(`🌐 API Base URL: http://localhost:${PORT}/api/v1`);
      console.log(`📋 Health Check: http://localhost:${PORT}/health`);
      console.log(`📊 API Info: http://localhost:${PORT}/api/v1`);

      if (config.nodeEnv === 'development') {
        console.log(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received. Shutting down gracefully...');

      server.close(async () => {
        console.log('HTTP server closed.');

        try {
          await prisma.$disconnect();
          console.log('Database connection closed.');
          process.exit(0);
        } catch (error) {
          console.error('Error during database disconnect:', error);
          process.exit(1);
        }
      });
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT received. Shutting down gracefully...');

      server.close(async () => {
        console.log('HTTP server closed.');

        try {
          await prisma.$disconnect();
          console.log('Database connection closed.');
          process.exit(0);
        } catch (error) {
          console.error('Error during database disconnect:', error);
          process.exit(1);
        }
      });
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
startServer();
