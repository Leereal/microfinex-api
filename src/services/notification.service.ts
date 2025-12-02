/**
 * Notification Service
 * Handles SMS, Email, and Push notifications with queue support
 */

// Use require for nodemailer since it doesn't have types
const nodemailer = require('nodemailer');
import { createClient } from 'redis';
import { prisma } from '../config/database';
import { smsProviderFactory, SMSResult } from '../providers/sms';
import {
  NOTIFICATION_TEMPLATES,
  TemplateData,
  compileTemplate,
  compileSMSTemplate,
  compileEmailTemplate,
} from '../templates/notification.templates';

// Notification types
export type NotificationType = 'SMS' | 'EMAIL' | 'PUSH';
export type NotificationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface NotificationRequest {
  type: NotificationType;
  to: string;
  templateId?: string;
  data?: TemplateData;
  subject?: string;
  message?: string;
  priority?: NotificationPriority;
  scheduledAt?: Date;
  metadata?: Record<string, any>;
}

export interface NotificationResult {
  success: boolean;
  notificationId?: string;
  messageId?: string;
  error?: string;
  provider?: string;
  timestamp: Date;
}

export interface QueuedNotification {
  id: string;
  type: NotificationType;
  to: string;
  subject?: string;
  message: string;
  templateId?: string;
  priority: NotificationPriority;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  scheduledAt?: Date;
  sentAt?: Date;
  metadata?: Record<string, any>;
  error?: string;
  createdAt: Date;
}

class NotificationService {
  private emailTransporter: any = null;
  private redisClient: ReturnType<typeof createClient> | null = null;
  private isRedisConnected = false;
  private readonly QUEUE_KEY = 'notifications:queue';
  private readonly FAILED_KEY = 'notifications:failed';

  constructor() {
    this.initializeEmailTransporter();
    this.initializeRedis();
  }

  /**
   * Initialize email transporter
   */
  private initializeEmailTransporter(): void {
    try {
      const host = process.env.SMTP_HOST;
      const port = parseInt(process.env.SMTP_PORT || '587');
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;

      if (host && user && pass) {
        this.emailTransporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
        });
        console.log('Email transporter initialized');
      } else {
        console.log('Email transporter not configured - missing SMTP settings');
      }
    } catch (error) {
      console.error('Failed to initialize email transporter:', error);
    }
  }

  /**
   * Initialize Redis connection for queue
   */
  private async initializeRedis(): Promise<void> {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      this.redisClient = createClient({ url: redisUrl });

      this.redisClient.on('error', (err) => {
        console.error('Redis error:', err);
        this.isRedisConnected = false;
      });

      this.redisClient.on('connect', () => {
        console.log('Redis connected for notification queue');
        this.isRedisConnected = true;
      });

      await this.redisClient.connect();
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      this.isRedisConnected = false;
    }
  }

  /**
   * Send SMS notification
   */
  async sendSMS(to: string, message: string): Promise<SMSResult> {
    return smsProviderFactory.sendSMS(to, message);
  }

  /**
   * Send SMS using template
   */
  async sendSMSFromTemplate(
    to: string,
    templateId: string,
    data: TemplateData
  ): Promise<SMSResult> {
    const message = compileSMSTemplate(templateId, data);
    if (!message) {
      return {
        success: false,
        error: `Template not found: ${templateId}`,
        provider: 'none',
        destination: to,
        timestamp: new Date(),
      };
    }
    return this.sendSMS(to, message);
  }

  /**
   * Send email notification
   */
  async sendEmail(
    to: string,
    subject: string,
    htmlBody: string,
    textBody?: string
  ): Promise<NotificationResult> {
    const timestamp = new Date();

    if (!this.emailTransporter) {
      // Development mode fallback
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV EMAIL] To: ${to}, Subject: ${subject}`);
        console.log(`Body: ${textBody || htmlBody.substring(0, 200)}...`);
        return {
          success: true,
          messageId: `DEV-EMAIL-${Date.now()}`,
          timestamp,
        };
      }

      return {
        success: false,
        error: 'Email transporter not configured',
        timestamp,
      };
    }

    try {
      const result = await this.emailTransporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@microfinex.com',
        to,
        subject,
        html: htmlBody,
        text: textBody || this.htmlToText(htmlBody),
      });

      return {
        success: true,
        messageId: result.messageId,
        timestamp,
      };
    } catch (error: any) {
      console.error('Email send error:', error);
      return {
        success: false,
        error: error.message,
        timestamp,
      };
    }
  }

  /**
   * Send email using template
   */
  async sendEmailFromTemplate(
    to: string,
    templateId: string,
    data: TemplateData
  ): Promise<NotificationResult> {
    const compiled = compileEmailTemplate(templateId, data);
    if (!compiled) {
      return {
        success: false,
        error: `Template not found: ${templateId}`,
        timestamp: new Date(),
      };
    }
    return this.sendEmail(to, compiled.subject, compiled.body);
  }

  /**
   * Queue notification for later sending
   */
  async queueNotification(request: NotificationRequest): Promise<string> {
    const notificationId = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Compile message from template if provided
    let message = request.message || '';
    let subject = request.subject;

    if (request.templateId && request.data) {
      if (request.type === 'SMS') {
        message = compileSMSTemplate(request.templateId, request.data) || message;
      } else if (request.type === 'EMAIL') {
        const compiled = compileEmailTemplate(request.templateId, request.data);
        if (compiled) {
          subject = compiled.subject;
          message = compiled.body;
        }
      }
    }

    const notification: QueuedNotification = {
      id: notificationId,
      type: request.type,
      to: request.to,
      subject,
      message,
      templateId: request.templateId,
      priority: request.priority || 'NORMAL',
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: request.scheduledAt,
      metadata: request.metadata,
      createdAt: new Date(),
    };

    if (this.isRedisConnected && this.redisClient) {
      // Add to Redis queue
      const score = this.getPriorityScore(notification.priority, notification.scheduledAt);
      await this.redisClient.zAdd(this.QUEUE_KEY, {
        score,
        value: JSON.stringify(notification),
      });
    } else {
      // Fallback: send immediately if no queue available
      console.log('Redis not available, sending notification immediately');
      await this.processNotification(notification);
    }

    return notificationId;
  }

  /**
   * Process a single notification
   */
  async processNotification(notification: QueuedNotification): Promise<NotificationResult> {
    const timestamp = new Date();

    try {
      let result: NotificationResult;

      switch (notification.type) {
        case 'SMS':
          const smsResult = await this.sendSMS(notification.to, notification.message);
          result = {
            success: smsResult.success,
            messageId: smsResult.messageId,
            error: smsResult.error,
            provider: smsResult.provider,
            timestamp,
          };
          break;

        case 'EMAIL':
          result = await this.sendEmail(
            notification.to,
            notification.subject || 'Notification',
            notification.message
          );
          break;

        default:
          result = {
            success: false,
            error: `Unsupported notification type: ${notification.type}`,
            timestamp,
          };
      }

      // Update notification status
      notification.status = result.success ? 'SENT' : 'FAILED';
      notification.sentAt = result.success ? timestamp : undefined;
      notification.error = result.error;
      notification.attempts++;

      return result;
    } catch (error: any) {
      notification.status = 'FAILED';
      notification.error = error.message;
      notification.attempts++;

      return {
        success: false,
        error: error.message,
        timestamp,
      };
    }
  }

  /**
   * Process queued notifications (called by job scheduler)
   */
  async processQueue(batchSize: number = 10): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    if (!this.isRedisConnected || !this.redisClient) {
      return { processed: 0, successful: 0, failed: 0 };
    }

    const now = Date.now();
    let processed = 0;
    let successful = 0;
    let failed = 0;

    try {
      // Get notifications ready to be sent (score <= now)
      const items = await this.redisClient.zRangeByScore(
        this.QUEUE_KEY,
        0,
        now,
        { LIMIT: { offset: 0, count: batchSize } }
      );

      for (const item of items) {
        const notification: QueuedNotification = JSON.parse(item);
        
        // Remove from queue
        await this.redisClient.zRem(this.QUEUE_KEY, item);

        // Process
        const result = await this.processNotification(notification);
        processed++;

        if (result.success) {
          successful++;
        } else {
          failed++;
          // Retry if under max attempts
          if (notification.attempts < notification.maxAttempts) {
            const retryDelay = Math.pow(2, notification.attempts) * 60000; // Exponential backoff
            notification.scheduledAt = new Date(now + retryDelay);
            const score = this.getPriorityScore(notification.priority, notification.scheduledAt);
            await this.redisClient.zAdd(this.QUEUE_KEY, {
              score,
              value: JSON.stringify(notification),
            });
          } else {
            // Move to failed queue
            await this.redisClient.lPush(this.FAILED_KEY, JSON.stringify(notification));
          }
        }
      }
    } catch (error) {
      console.error('Queue processing error:', error);
    }

    return { processed, successful, failed };
  }

  /**
   * Get priority score for queue ordering
   */
  private getPriorityScore(priority: NotificationPriority, scheduledAt?: Date): number {
    const now = Date.now();
    const scheduleTime = scheduledAt?.getTime() || now;

    // Priority modifiers (lower = higher priority)
    const priorityModifiers: Record<NotificationPriority, number> = {
      URGENT: -1000000000,
      HIGH: -100000000,
      NORMAL: 0,
      LOW: 100000000,
    };

    return scheduleTime + priorityModifiers[priority];
  }

  /**
   * Simple HTML to text converter
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/td>/gi, '\t')
      .replace(/<\/th>/gi, '\t')
      .replace(/<li>/gi, '• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    pending: number;
    failed: number;
    byPriority: Record<NotificationPriority, number>;
  }> {
    if (!this.isRedisConnected || !this.redisClient) {
      return { pending: 0, failed: 0, byPriority: { URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 } };
    }

    const pending = await this.redisClient.zCard(this.QUEUE_KEY);
    const failed = await this.redisClient.lLen(this.FAILED_KEY);

    // Get breakdown by priority (simplified)
    const byPriority: Record<NotificationPriority, number> = {
      URGENT: 0,
      HIGH: 0,
      NORMAL: 0,
      LOW: 0,
    };

    return { pending, failed, byPriority };
  }

  /**
   * Send bulk notifications
   */
  async sendBulk(
    type: NotificationType,
    recipients: Array<{ to: string; data?: TemplateData }>,
    templateId: string,
    priority: NotificationPriority = 'NORMAL'
  ): Promise<{ queued: number; failed: number }> {
    let queued = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        await this.queueNotification({
          type,
          to: recipient.to,
          templateId,
          data: recipient.data,
          priority,
        });
        queued++;
      } catch (error) {
        failed++;
      }
    }

    return { queued, failed };
  }

  /**
   * Get SMS provider balance
   */
  async getSMSBalance(): Promise<Array<{ provider: string; balance: number; currency: string }>> {
    return smsProviderFactory.getAllBalances();
  }
}

export const notificationService = new NotificationService();
