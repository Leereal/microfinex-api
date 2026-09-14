import app from './app';
import { config } from './config';
import { prisma } from './config/database';
import { cacheService } from './services/cache.service';
import { startScheduler, stopScheduler } from './jobs/scheduler';
import { commsDispatcher } from './services/communications/comms.dispatcher';
import { aiExtractionService } from './services/ai-extraction.service';
import { closePdfBrowser } from './services/pdf.service';

const PORT = config.port;

/**
 * Start the server
 */
const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    // Initialize Redis cache
    try {
      await cacheService.connect();
      console.log('✅ Redis cache connected successfully');
    } catch (error) {
      console.warn('⚠️ Redis cache not available, running without caching');
    }

    // Move organizations off AI models the provider has shut down. Without
    // this every extraction request fails against a dead model id.
    try {
      const migrated = await aiExtractionService.migrateRetiredModels();
      if (migrated > 0) {
        console.log(
          `✅ Migrated ${migrated} AI config(s) off retired models`
        );
      }
    } catch (error) {
      console.warn('⚠️ Could not check for retired AI models:', error);
    }

    // Start background jobs (loan engine, arrears, reminders). Without these
    // loans never transition to OVERDUE and penalties never accrue.
    if (process.env.ENABLE_SCHEDULER === 'true') {
      const count = startScheduler();
      console.log(`✅ Scheduler started with ${count} job(s)`);
    } else {
      console.warn(
        '⚠️  Scheduler disabled. Loan status transitions, penalties and ' +
          'reminders will not run. Set ENABLE_SCHEDULER=true to enable.'
      );
    }

    // Sends queued client messages (broadcasts) and fetches SMS delivery
    // reports. Independent of the scheduler, so messages are never left
    // unsent because ENABLE_SCHEDULER is off. COMMS_DISPATCHER=false turns it
    // off on an instance that should not send.
    if (process.env.COMMS_DISPATCHER !== 'false') {
      commsDispatcher.start();
      console.log('✅ Communications dispatcher started');
    }

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

        // The PDF renderer keeps a headless Chromium alive between requests;
        // it has to be told to stop or the process will not exit.
        await closePdfBrowser().catch(() => {});

        try {
          await stopScheduler();
          commsDispatcher.stop();
          console.log('Scheduler stopped.');
          await cacheService.disconnect();
          console.log('Redis cache disconnected.');
          await prisma.$disconnect();
          console.log('Database connection closed.');
          process.exit(0);
        } catch (error) {
          console.error('Error during shutdown:', error);
          process.exit(1);
        }
      });
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT received. Shutting down gracefully...');

      server.close(async () => {
        console.log('HTTP server closed.');

        // The PDF renderer keeps a headless Chromium alive between requests;
        // it has to be told to stop or the process will not exit.
        await closePdfBrowser().catch(() => {});

        try {
          await stopScheduler();
          commsDispatcher.stop();
          console.log('Scheduler stopped.');
          await cacheService.disconnect();
          console.log('Redis cache disconnected.');
          await prisma.$disconnect();
          console.log('Database connection closed.');
          process.exit(0);
        } catch (error) {
          console.error('Error during shutdown:', error);
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
