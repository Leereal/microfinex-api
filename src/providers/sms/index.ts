/**
 * SMS Provider Factory
 * Manages SMS provider selection and fallback
 */

import { SMSProvider, SMSResult, econetSMSProvider } from './econet';
import { twilioSMSProvider } from './twilio';

export { SMSProvider, SMSResult } from './econet';

export type SMSProviderType = 'econet' | 'twilio' | 'auto';

class SMSProviderFactory {
  private providers: Map<string, SMSProvider> = new Map();
  private primaryProvider: SMSProviderType = 'econet';
  private fallbackEnabled: boolean = true;

  constructor() {
    this.providers.set('econet', econetSMSProvider);
    this.providers.set('twilio', twilioSMSProvider);

    // Set primary provider from env
    const configuredProvider = process.env.SMS_PROVIDER?.toLowerCase() as SMSProviderType;
    if (configuredProvider && this.providers.has(configuredProvider)) {
      this.primaryProvider = configuredProvider;
    }

    this.fallbackEnabled = process.env.SMS_FALLBACK_ENABLED !== 'false';
  }

  /**
   * Get a specific provider
   */
  getProvider(name: SMSProviderType): SMSProvider | undefined {
    if (name === 'auto') {
      return this.providers.get(this.primaryProvider);
    }
    return this.providers.get(name);
  }

  /**
   * Send SMS with automatic fallback
   */
  async sendSMS(to: string, message: string, preferredProvider?: SMSProviderType): Promise<SMSResult> {
    const providerName = preferredProvider || this.primaryProvider;
    const primaryProvider = this.providers.get(providerName === 'auto' ? this.primaryProvider : providerName);

    if (!primaryProvider) {
      return {
        success: false,
        error: 'No SMS provider configured',
        provider: 'none',
        destination: to,
        timestamp: new Date(),
      };
    }

    // Try primary provider
    let result = await primaryProvider.sendSMS(to, message);

    // Fallback if enabled and primary failed
    if (!result.success && this.fallbackEnabled) {
      const fallbackProviderName = providerName === 'econet' ? 'twilio' : 'econet';
      const fallbackProvider = this.providers.get(fallbackProviderName);

      if (fallbackProvider) {
        console.log(`SMS fallback: ${providerName} failed, trying ${fallbackProviderName}`);
        result = await fallbackProvider.sendSMS(to, message);
      }
    }

    return result;
  }

  /**
   * Get all providers' balances
   */
  async getAllBalances(): Promise<Array<{ provider: string; balance: number; currency: string }>> {
    const balances: Array<{ provider: string; balance: number; currency: string }> = [];

    for (const [name, provider] of this.providers) {
      if (provider.getBalance) {
        const balance = await provider.getBalance();
        balances.push({ provider: name, ...balance });
      }
    }

    return balances;
  }

  /**
   * Get list of available providers
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Set primary provider
   */
  setPrimaryProvider(name: SMSProviderType): void {
    if (this.providers.has(name) || name === 'auto') {
      this.primaryProvider = name;
    }
  }
}

export const smsProviderFactory = new SMSProviderFactory();
