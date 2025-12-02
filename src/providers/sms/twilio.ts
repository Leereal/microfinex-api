/**
 * Twilio SMS Provider
 * Fallback/alternative SMS provider
 */

import { SMSProvider, SMSResult } from './econet';

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export class TwilioSMSProvider implements SMSProvider {
  readonly name = 'Twilio';
  private config: TwilioConfig;

  constructor() {
    this.config = {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      fromNumber: process.env.TWILIO_FROM_NUMBER || '',
    };
  }

  /**
   * Send SMS via Twilio
   */
  async sendSMS(to: string, message: string): Promise<SMSResult> {
    const timestamp = new Date();

    try {
      // Normalize phone number
      const normalizedPhone = this.normalizePhoneNumber(to);

      if (!normalizedPhone) {
        return {
          success: false,
          error: 'Invalid phone number format',
          provider: this.name,
          destination: to,
          timestamp,
        };
      }

      // Development mode - just log
      if (process.env.NODE_ENV === 'development' && !this.config.accountSid) {
        console.log(`[DEV TWILIO SMS] To: ${normalizedPhone}, Message: ${message}`);
        return {
          success: true,
          messageId: `TWILIO-DEV-${Date.now()}`,
          provider: this.name,
          destination: normalizedPhone,
          timestamp,
        };
      }

      // Twilio API call
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
      const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: normalizedPhone,
          From: this.config.fromNumber,
          Body: message,
        }).toString(),
      });

      const result = await response.json() as { sid?: string; message?: string };

      if (response.ok) {
        return {
          success: true,
          messageId: result.sid,
          provider: this.name,
          destination: normalizedPhone,
          timestamp,
        };
      }

      return {
        success: false,
        error: result.message || 'Twilio API error',
        provider: this.name,
        destination: normalizedPhone,
        timestamp,
      };
    } catch (error: any) {
      console.error('Twilio SMS error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send SMS via Twilio',
        provider: this.name,
        destination: to,
        timestamp,
      };
    }
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<{ balance: number; currency: string }> {
    try {
      if (process.env.NODE_ENV === 'development' && !this.config.accountSid) {
        return { balance: 9999, currency: 'USD' };
      }

      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Balance.json`;
      const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });

      const result = await response.json() as { balance?: string; currency?: string };
      return {
        balance: parseFloat(result.balance || '0') || 0,
        currency: result.currency || 'USD',
      };
    } catch (error) {
      console.error('Failed to get Twilio balance:', error);
      return { balance: 0, currency: 'USD' };
    }
  }

  /**
   * Get message delivery status
   */
  async getDeliveryStatus(messageId: string): Promise<{
    status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'EXPIRED';
    timestamp?: Date;
  }> {
    try {
      if (process.env.NODE_ENV === 'development' && messageId.startsWith('TWILIO-DEV-')) {
        return { status: 'DELIVERED', timestamp: new Date() };
      }

      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages/${messageId}.json`;
      const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });

      const result = await response.json() as { status?: string; date_updated?: string };

      const statusMap: Record<string, 'PENDING' | 'DELIVERED' | 'FAILED' | 'EXPIRED'> = {
        'queued': 'PENDING',
        'sending': 'PENDING',
        'sent': 'PENDING',
        'delivered': 'DELIVERED',
        'undelivered': 'FAILED',
        'failed': 'FAILED',
      };

      const statusKey = result.status || '';
      return {
        status: statusMap[statusKey] || 'PENDING',
        timestamp: result.date_updated ? new Date(result.date_updated) : undefined,
      };
    } catch (error) {
      console.error('Failed to get Twilio delivery status:', error);
      return { status: 'PENDING' };
    }
  }

  /**
   * Normalize phone number to E.164 format
   */
  private normalizePhoneNumber(phone: string): string | null {
    let cleaned = phone.replace(/\D/g, '');

    // Already has country code
    if (cleaned.length >= 10 && cleaned.length <= 15) {
      if (!cleaned.startsWith('+')) {
        return `+${cleaned}`;
      }
      return cleaned;
    }

    return null;
  }
}

export const twilioSMSProvider = new TwilioSMSProvider();
