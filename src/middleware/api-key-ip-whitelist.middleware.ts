import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase-enhanced';
import crypto from 'crypto';

interface IPWhitelistEntry {
  id: string;
  apiKeyId: string;
  ipAddress: string;
  cidr?: number;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

interface IPValidationResult {
  allowed: boolean;
  reason?: string;
  matchedRule?: string;
}

interface WhitelistResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

/**
 * Parse CIDR notation and check if IP is in range
 */
function ipInRange(ip: string, network: string, cidr: number): boolean {
  const ipParts = ip.split('.').map(Number);
  const networkParts = network.split('.').map(Number);

  if (ipParts.length !== 4 || networkParts.length !== 4) {
    return false;
  }

  const ip0 = ipParts[0] ?? 0;
  const ip1 = ipParts[1] ?? 0;
  const ip2 = ipParts[2] ?? 0;
  const ip3 = ipParts[3] ?? 0;
  
  const net0 = networkParts[0] ?? 0;
  const net1 = networkParts[1] ?? 0;
  const net2 = networkParts[2] ?? 0;
  const net3 = networkParts[3] ?? 0;

  const ipInt = (ip0 << 24) + (ip1 << 16) + (ip2 << 8) + ip3;
  const networkInt = (net0 << 24) + (net1 << 16) + (net2 << 8) + net3;
  
  const mask = cidr === 0 ? 0 : (~0 << (32 - cidr));
  
  return (ipInt & mask) === (networkInt & mask);
}

/**
 * Parse IP address (handle IPv6-mapped IPv4)
 */
function parseIPAddress(ip: string): string {
  // Handle IPv6-mapped IPv4 addresses
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

/**
 * Validate an IP address format
 */
function isValidIP(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

class APIKeyIPWhitelistService {
  /**
   * Add IP to whitelist
   */
  async addToWhitelist(
    apiKeyId: string,
    ipAddress: string,
    options?: { cidr?: number; description?: string; expiresAt?: Date }
  ): Promise<WhitelistResult> {
    try {
      // Validate IP format
      if (!isValidIP(ipAddress)) {
        return { success: false, message: 'Invalid IP address format', error: 'INVALID_IP' };
      }

      // Validate CIDR if provided
      if (options?.cidr !== undefined && (options.cidr < 0 || options.cidr > 32)) {
        return { success: false, message: 'Invalid CIDR value (must be 0-32)', error: 'INVALID_CIDR' };
      }

      // Check if entry already exists
      const { data: existing } = await supabaseAdmin
        .from('api_key_ip_whitelist')
        .select('id')
        .eq('apiKeyId', apiKeyId)
        .eq('ipAddress', ipAddress)
        .single();

      if (existing) {
        return { success: false, message: 'IP address already whitelisted', error: 'DUPLICATE_ENTRY' };
      }

      const { data, error } = await supabaseAdmin
        .from('api_key_ip_whitelist')
        .insert({
          apiKeyId,
          ipAddress,
          cidr: options?.cidr || null,
          description: options?.description || null,
          expiresAt: options?.expiresAt?.toISOString() || null,
          isActive: true,
        })
        .select()
        .single();

      if (error) {
        console.error('Whitelist insert error:', error);
        return { success: false, message: 'Failed to add IP to whitelist', error: error.message };
      }

      return {
        success: true,
        message: 'IP address added to whitelist',
        data: { entry: data },
      };
    } catch (error: any) {
      console.error('Add to whitelist error:', error);
      return { success: false, message: 'Failed to add IP to whitelist', error: error.message };
    }
  }

  /**
   * Remove IP from whitelist
   */
  async removeFromWhitelist(apiKeyId: string, whitelistEntryId: string): Promise<WhitelistResult> {
    try {
      const { error } = await supabaseAdmin
        .from('api_key_ip_whitelist')
        .delete()
        .eq('id', whitelistEntryId)
        .eq('apiKeyId', apiKeyId);

      if (error) {
        return { success: false, message: 'Failed to remove IP from whitelist', error: error.message };
      }

      return { success: true, message: 'IP address removed from whitelist' };
    } catch (error: any) {
      return { success: false, message: 'Failed to remove IP from whitelist', error: error.message };
    }
  }

  /**
   * Get all whitelisted IPs for an API key
   */
  async getWhitelist(apiKeyId: string): Promise<WhitelistResult> {
    try {
      const { data, error } = await supabaseAdmin
        .from('api_key_ip_whitelist')
        .select('*')
        .eq('apiKeyId', apiKeyId)
        .eq('isActive', true)
        .order('createdAt', { ascending: false });

      if (error) {
        return { success: false, message: 'Failed to get whitelist', error: error.message };
      }

      return {
        success: true,
        message: 'Whitelist retrieved',
        data: { entries: data || [], count: data?.length || 0 },
      };
    } catch (error: any) {
      return { success: false, message: 'Failed to get whitelist', error: error.message };
    }
  }

  /**
   * Validate if an IP is allowed for an API key
   */
  async validateIP(apiKeyId: string, clientIP: string): Promise<IPValidationResult> {
    try {
      const parsedIP = parseIPAddress(clientIP);

      // Get API key settings
      const { data: apiKey, error: apiKeyError } = await supabaseAdmin
        .from('api_keys')
        .select('id, settings')
        .eq('id', apiKeyId)
        .single();

      if (apiKeyError || !apiKey) {
        return { allowed: false, reason: 'API key not found' };
      }

      // Check if IP whitelisting is enabled for this key
      const ipWhitelistEnabled = apiKey.settings?.ipWhitelistEnabled ?? false;
      
      if (!ipWhitelistEnabled) {
        return { allowed: true, reason: 'IP whitelisting not enabled' };
      }

      // Get whitelist entries
      const { data: entries, error } = await supabaseAdmin
        .from('api_key_ip_whitelist')
        .select('*')
        .eq('apiKeyId', apiKeyId)
        .eq('isActive', true);

      if (error) {
        console.error('Error fetching whitelist:', error);
        return { allowed: false, reason: 'Failed to validate IP' };
      }

      // If no entries and whitelist is enabled, deny access
      if (!entries || entries.length === 0) {
        return { allowed: false, reason: 'No IP addresses whitelisted' };
      }

      // Check against whitelist
      const now = new Date();
      for (const entry of entries) {
        // Check if entry has expired
        if (entry.expiresAt && new Date(entry.expiresAt) < now) {
          continue;
        }

        // Exact match
        if (entry.ipAddress === parsedIP) {
          return { allowed: true, matchedRule: entry.ipAddress };
        }

        // CIDR match
        if (entry.cidr && ipInRange(parsedIP, entry.ipAddress, entry.cidr)) {
          return { allowed: true, matchedRule: `${entry.ipAddress}/${entry.cidr}` };
        }
      }

      return { allowed: false, reason: 'IP not in whitelist' };
    } catch (error: any) {
      console.error('IP validation error:', error);
      return { allowed: false, reason: 'Validation error' };
    }
  }

  /**
   * Update whitelist entry
   */
  async updateWhitelistEntry(
    apiKeyId: string,
    entryId: string,
    updates: { description?: string; isActive?: boolean; expiresAt?: Date | null }
  ): Promise<WhitelistResult> {
    try {
      const updateData: any = {};
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
      if (updates.expiresAt !== undefined) {
        updateData.expiresAt = updates.expiresAt?.toISOString() || null;
      }

      const { data, error } = await supabaseAdmin
        .from('api_key_ip_whitelist')
        .update(updateData)
        .eq('id', entryId)
        .eq('apiKeyId', apiKeyId)
        .select()
        .single();

      if (error) {
        return { success: false, message: 'Failed to update whitelist entry', error: error.message };
      }

      return { success: true, message: 'Whitelist entry updated', data: { entry: data } };
    } catch (error: any) {
      return { success: false, message: 'Failed to update whitelist entry', error: error.message };
    }
  }

  /**
   * Enable/disable IP whitelisting for an API key
   */
  async toggleIPWhitelist(apiKeyId: string, enabled: boolean): Promise<WhitelistResult> {
    try {
      const { data: apiKey } = await supabaseAdmin
        .from('api_keys')
        .select('settings')
        .eq('id', apiKeyId)
        .single();

      const settings = { ...(apiKey?.settings || {}), ipWhitelistEnabled: enabled };

      const { error } = await supabaseAdmin
        .from('api_keys')
        .update({ settings })
        .eq('id', apiKeyId);

      if (error) {
        return { success: false, message: 'Failed to toggle IP whitelist', error: error.message };
      }

      return {
        success: true,
        message: `IP whitelisting ${enabled ? 'enabled' : 'disabled'}`,
        data: { enabled },
      };
    } catch (error: any) {
      return { success: false, message: 'Failed to toggle IP whitelist', error: error.message };
    }
  }

  /**
   * Bulk add IPs to whitelist
   */
  async bulkAddToWhitelist(
    apiKeyId: string,
    ips: Array<{ ipAddress: string; cidr?: number; description?: string }>
  ): Promise<WhitelistResult> {
    try {
      const validIPs: Array<any> = [];
      const invalidIPs: string[] = [];

      for (const entry of ips) {
        if (isValidIP(entry.ipAddress)) {
          validIPs.push({
            apiKeyId,
            ipAddress: entry.ipAddress,
            cidr: entry.cidr || null,
            description: entry.description || null,
            isActive: true,
          });
        } else {
          invalidIPs.push(entry.ipAddress);
        }
      }

      if (validIPs.length === 0) {
        return { success: false, message: 'No valid IP addresses provided', error: 'NO_VALID_IPS' };
      }

      const { data, error } = await supabaseAdmin
        .from('api_key_ip_whitelist')
        .insert(validIPs)
        .select();

      if (error) {
        return { success: false, message: 'Failed to add IPs to whitelist', error: error.message };
      }

      return {
        success: true,
        message: `Added ${data.length} IPs to whitelist`,
        data: { added: data.length, invalid: invalidIPs },
      };
    } catch (error: any) {
      return { success: false, message: 'Failed to bulk add IPs', error: error.message };
    }
  }

  /**
   * Clear all whitelist entries for an API key
   */
  async clearWhitelist(apiKeyId: string): Promise<WhitelistResult> {
    try {
      const { error } = await supabaseAdmin
        .from('api_key_ip_whitelist')
        .delete()
        .eq('apiKeyId', apiKeyId);

      if (error) {
        return { success: false, message: 'Failed to clear whitelist', error: error.message };
      }

      return { success: true, message: 'Whitelist cleared' };
    } catch (error: any) {
      return { success: false, message: 'Failed to clear whitelist', error: error.message };
    }
  }
}

export const apiKeyIPWhitelistService = new APIKeyIPWhitelistService();

/**
 * Express middleware for API key IP validation
 */
export async function validateApiKeyIP(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const apiKey = (req as any).apiKey;
    
    if (!apiKey) {
      // No API key, skip IP validation
      next();
      return;
    }

    const clientIP = req.ip || req.socket.remoteAddress || '';
    const validation = await apiKeyIPWhitelistService.validateIP(apiKey.id, clientIP);

    if (!validation.allowed) {
      // Log blocked access attempt
      await supabaseAdmin.from('audit_logs').insert({
        action: 'API_KEY_IP_BLOCKED',
        resource: 'api_keys',
        resourceId: apiKey.id,
        newValue: {
          ip: clientIP,
          reason: validation.reason,
          path: req.path,
        },
      });

      res.status(403).json({
        success: false,
        error: {
          code: 'IP_NOT_ALLOWED',
          message: 'Access denied: IP address not whitelisted for this API key',
          reason: validation.reason,
        },
      });
      return;
    }

    next();
  } catch (error: any) {
    console.error('API key IP validation error:', error);
    next();
  }
}
