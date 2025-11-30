import { prisma } from '../config/database';

export interface OrganizationSettingsInput {
  settingKey: string;
  settingValue: any;
  description?: string;
  updatedBy?: string;
}

export class SettingsService {
  /**
   * Get a setting value by key for an organization.
   * Returns the setting value or null if not found.
   * Falls back to system defaults if not found in organization settings (optional implementation).
   */
  async get(organizationId: string, key: string): Promise<any> {
    const setting = await prisma.organizationSettings.findUnique({
      where: {
        organizationId_settingKey: {
          organizationId,
          settingKey: key,
        },
      },
    });

    if (setting) {
      return setting.settingValue;
    }

    // Fallback to system default if needed
    const systemSetting = await prisma.systemSettings.findUnique({
      where: { settingKey: key },
    });

    return systemSetting ? systemSetting.settingValue : null;
  }

  /**
   * Set or update a setting for an organization.
   */
  async set(
    organizationId: string,
    input: OrganizationSettingsInput
  ): Promise<any> {
    return prisma.organizationSettings.upsert({
      where: {
        organizationId_settingKey: {
          organizationId,
          settingKey: input.settingKey,
        },
      },
      update: {
        settingValue: input.settingValue,
        description: input.description,
        updatedBy: input.updatedBy,
      },
      create: {
        organizationId,
        settingKey: input.settingKey,
        settingValue: input.settingValue,
        description: input.description,
        updatedBy: input.updatedBy,
      },
    });
  }

  /**
   * Get all settings for an organization.
   * Merges with system defaults.
   */
  async getAll(organizationId: string): Promise<Record<string, any>> {
    const orgSettings = await prisma.organizationSettings.findMany({
      where: { organizationId },
    });

    const systemSettings = await prisma.systemSettings.findMany();

    const settingsMap: Record<string, any> = {};

    // Apply system defaults first
    for (const setting of systemSettings) {
      settingsMap[setting.settingKey] = setting.settingValue;
    }

    // Override with organization settings
    for (const setting of orgSettings) {
      settingsMap[setting.settingKey] = setting.settingValue;
    }

    return settingsMap;
  }

  /**
   * Reset a setting to default (delete organization override).
   */
  async reset(organizationId: string, key: string): Promise<void> {
    await prisma.organizationSettings.delete({
      where: {
        organizationId_settingKey: {
          organizationId,
          settingKey: key,
        },
      },
    });
  }
}

export const settingsService = new SettingsService();
