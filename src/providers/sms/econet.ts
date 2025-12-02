/**
 * Econet SMS Provider
 * Integration with Econet SMS Gateway for Zimbabwe
 */

import { config } from '../../config';

export interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: string;
  destination: string;
  timestamp: Date;
}

export interface SMSProvider {
  name: string;
  sendSMS(to: string, message: string): Promise<SMSResult>;
  getBalance?(): Promise<{ balance: number; currency: string }>;
  getDeliveryStatus?(messageId: string): Promise<{
    status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'EXPIRED';
    timestamp?: Date;
  }>;
}

interface EconetConfig {
  apiUrl: string;
  apiKey: string;
  senderId: string;
  username?: string;
  password?: string;
}

export class EconetSMSProvider implements SMSProvider {
  readonly name = 'Econet';
  private config: EconetConfig;

  constructor() {
    this.config = {
      apiUrl: process.env.ECONET_SMS_API_URL || 'https://sms.econet.co.zw/api/v1',
      apiKey: process.env.ECONET_SMS_API_KEY || '',
      senderId: process.env.ECONET_SMS_SENDER_ID || 'MICROFINEX',
      username: process.env.ECONET_SMS_USERNAME,
      password: process.env.ECONET_SMS_PASSWORD,
    };
  }

  /**
   * Send SMS via Econet Gateway
   */
  async sendSMS(to: string, message: string): Promise<SMSResult> {
    const timestamp = new Date();
    
    try {
      // Normalize phone number to E.164 format for Zimbabwe
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

      // Check if in development mode - just log instead of sending
      if (process.env.NODE_ENV === 'development' && !process.env.ECONET_SMS_API_KEY) {
        console.log(`[DEV SMS] To: ${normalizedPhone}, Message: ${message}`);
        return {
          success: true,
          messageId: `DEV-${Date.now()}`,
          provider: this.name,
          destination: normalizedPhone,
          timestamp,
        };
      }

      // Make API call to Econet
      const response = await fetch(`${this.config.apiUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-API-Key': this.config.apiKey,
        },
        body: JSON.stringify({
          to: normalizedPhone,
          message: message,
          sender_id: this.config.senderId,
          // Optional fields
          callback_url: process.env.ECONET_SMS_CALLBACK_URL,
          reference: `MFX-${Date.now()}`,
        }),
      });

      const result = await response.json() as { success?: boolean; message_id?: string; id?: string; message?: string; error?: string };

      if (response.ok && result.success) {
        return {
          success: true,
          messageId: result.message_id || result.id,
          provider: this.name,
          destination: normalizedPhone,
          timestamp,
        };
      }

      return {
        success: false,
        error: result.message || result.error || 'Unknown error from Econet API',
        provider: this.name,
        destination: normalizedPhone,
        timestamp,
      };
    } catch (error: any) {
      console.error('Econet SMS error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send SMS',
        provider: this.name,
        destination: to,
        timestamp,
      };
    }
  }

  /**
   * Get SMS balance
   */
  async getBalance(): Promise<{ balance: number; currency: string }> {
    try {
      if (process.env.NODE_ENV === 'development' && !this.config.apiKey) {
        return { balance: 9999, currency: 'USD' };
      }

      const response = await fetch(`${this.config.apiUrl}/balance`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-API-Key': this.config.apiKey,
        },
      });

      const result = await response.json() as { balance?: number; currency?: string };
      return {
        balance: result.balance || 0,
        currency: result.currency || 'USD',
      };
    } catch (error) {
      console.error('Failed to get Econet SMS balance:', error);
      return { balance: 0, currency: 'USD' };
    }
  }

  /**
   * Get delivery status of a message
   */
  async getDeliveryStatus(messageId: string): Promise<{
    status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'EXPIRED';
    timestamp?: Date;
  }> {
    try {
      if (process.env.NODE_ENV === 'development' && messageId.startsWith('DEV-')) {
        return { status: 'DELIVERED', timestamp: new Date() };
      }

      const response = await fetch(`${this.config.apiUrl}/messages/${messageId}/status`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-API-Key': this.config.apiKey,
        },
      });

      const result = await response.json() as { status?: string; delivered_at?: string };
      
      const statusMap: Record<string, 'PENDING' | 'DELIVERED' | 'FAILED' | 'EXPIRED'> = {
        'pending': 'PENDING',
        'sent': 'PENDING',
        'delivered': 'DELIVERED',
        'failed': 'FAILED',
        'expired': 'EXPIRED',
        'rejected': 'FAILED',
      };

      const statusKey = result.status?.toLowerCase() || '';
      return {
        status: statusMap[statusKey] || 'PENDING',
        timestamp: result.delivered_at ? new Date(result.delivered_at) : undefined,
      };
    } catch (error) {
      console.error('Failed to get delivery status:', error);
      return { status: 'PENDING' };
    }
  }

  /**
   * Normalize phone number to E.164 format for Zimbabwe
   */
  private normalizePhoneNumber(phone: string): string | null {
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');

    // Handle Zimbabwe numbers
    if (cleaned.startsWith('263')) {
      // Already in international format
      return `+${cleaned}`;
    } else if (cleaned.startsWith('0')) {
      // Local format (07x xxx xxxx)
      return `+263${cleaned.substring(1)}`;
    } else if (cleaned.length === 9 && (cleaned.startsWith('7') || cleaned.startsWith('8'))) {
      // Missing leading zero
      return `+263${cleaned}`;
    }

    // Return as-is for international numbers
    if (cleaned.length >= 10) {
      return `+${cleaned}`;
    }

    return null;
  }
}

// Export singleton instance
export const econetSMSProvider = new EconetSMSProvider();
