import { createClient, RedisClientType } from 'redis';
import { config } from '../config';

// Cache TTL in seconds (30 minutes)
const DEFAULT_TTL = 30 * 60;

class CacheService {
  private client: RedisClientType | null = null;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  /**
   * Initialize Redis connection
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      try {
        this.client = createClient({
          url: config.redis.url,
        });

        this.client.on('error', err => {
          console.error('Redis Client Error:', err);
          this.isConnected = false;
        });

        this.client.on('connect', () => {
          console.log('Redis connected for caching');
        });

        this.client.on('reconnecting', () => {
          console.log('Redis reconnecting...');
        });

        await this.client.connect();
        this.isConnected = true;
      } catch (error) {
        console.error('Failed to connect to Redis:', error);
        this.isConnected = false;
        this.client = null;
      }
    })();

    return this.connectionPromise;
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected || !this.client) {
      await this.connect();
      if (!this.client) return null;
    }

    try {
      const data = await this.client.get(key);
      if (data) {
        return JSON.parse(data) as T;
      }
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Set a value in cache with TTL
   */
  async set(
    key: string,
    value: any,
    ttlSeconds: number = DEFAULT_TTL
  ): Promise<boolean> {
    if (!this.isConnected || !this.client) {
      await this.connect();
      if (!this.client) return false;
    }

    try {
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  /**
   * Delete a specific key from cache
   */
  async delete(key: string): Promise<boolean> {
    if (!this.isConnected || !this.client) {
      await this.connect();
      if (!this.client) return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  /**
   * Delete all keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<boolean> {
    if (!this.isConnected || !this.client) {
      await this.connect();
      if (!this.client) return false;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Cache deletePattern error:', error);
      return false;
    }
  }

  /**
   * Generate a cache key for clients list
   */
  generateClientsKey(
    organizationId: string,
    filters: Record<string, any>
  ): string {
    // Create a deterministic key from filters
    const filterParts = Object.entries(filters)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join('|');

    return `clients:${organizationId}:${filterParts || 'all'}`;
  }

  /**
   * Invalidate all clients cache for an organization
   */
  async invalidateClientsCache(organizationId: string): Promise<boolean> {
    return this.deletePattern(`clients:${organizationId}:*`);
  }

  /**
   * Invalidate all clients cache (for all organizations)
   */
  async invalidateAllClientsCache(): Promise<boolean> {
    return this.deletePattern('clients:*');
  }

  /**
   * Get cache statistics for debugging
   */
  async getStats(): Promise<{ connected: boolean; keys?: number }> {
    if (!this.isConnected || !this.client) {
      return { connected: false };
    }

    try {
      const keys = await this.client.keys('*');
      return { connected: true, keys: keys.length };
    } catch {
      return { connected: false };
    }
  }

  /**
   * Check if cache is connected
   */
  isReady(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
        this.isConnected = false;
        this.client = null;
        this.connectionPromise = null;
      } catch (error) {
        console.error('Error disconnecting from Redis:', error);
      }
    }
  }
}

// Singleton instance
export const cacheService = new CacheService();

// Initialize connection on module load
cacheService.connect().catch(console.error);
