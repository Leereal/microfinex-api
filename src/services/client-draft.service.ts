import { z } from 'zod';
import { prisma } from '../config/database';

// Draft data schema - flexible to accept partial client data
export const clientDraftDataSchema = z
  .object({
    // Personal Information
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    middle_name: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional(),
    gender: z.enum(['male', 'female', 'other']).nullable().optional(),
    marital_status: z.string().nullable().optional(),
    nationality: z.string().nullable().optional(),
    title: z.string().nullable().optional(),

    // Identification
    id_type: z.string().nullable().optional(),
    id_number: z.string().nullable().optional(),
    passport_number: z.string().nullable().optional(),
    passport_country: z.string().nullable().optional(),

    // Address
    street_number: z.string().nullable().optional(),
    suburb: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    zip_code: z.string().nullable().optional(),
    postal_code: z.string().nullable().optional(),

    // Contacts
    contacts: z
      .array(
        z.object({
          id: z.number().nullable().optional(),
          phone: z.string().nullable().optional(),
          type: z.string().nullable().optional(),
          is_primary: z.boolean().nullable().optional(),
          whatsapp: z.boolean().nullable().optional(),
          is_active: z.boolean().nullable().optional(),
          country_code: z.string().nullable().optional(),
        })
      )
      .nullable()
      .optional(),
    emails: z.array(z.string().nullable()).nullable().optional(),

    // Next of Kin
    next_of_kin: z
      .object({
        first_name: z.string().nullable().optional(),
        last_name: z.string().nullable().optional(),
        relationship: z.string().nullable().optional(),
        phone_number: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),

    // Employment
    employer: z
      .object({
        name: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        occupation: z.string().nullable().optional(),
        employment_date: z.string().nullable().optional(),
        net_salary: z.number().nullable().optional(),
        department: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),

    // Credit Limits
    client_limit: z
      .object({
        id: z.number().nullable().optional(),
        max_loan: z.number().nullable().optional(),
        credit_score: z.string().nullable().optional(),
        currency: z.number().nullable().optional(),
        currency_name: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    client_limits: z
      .array(
        z.object({
          currency_id: z.number().nullable().optional(),
          currency: z.string().nullable().optional(),
          max_loan_amount: z.union([z.string(), z.number()]).nullable().optional(),
          credit_score: z.string().nullable().optional(),
        })
      )
      .nullable()
      .optional(),

    // Documents (metadata only)
    documents: z.array(z.any()).optional(),

    // Other fields
    photo: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    branch: z.number().optional(),
  })
  .passthrough(); // Allow additional fields

export const saveDraftSchema = z.object({
  draftData: clientDraftDataSchema,
  lastFieldUpdated: z.string().optional(),
});

export const updateDraftFieldSchema = z.object({
  fieldPath: z.string(),
  value: z.any(),
});

// Required fields for a complete client
const REQUIRED_FIELDS = [
  'first_name',
  'last_name',
  'date_of_birth',
  'id_type',
  'id_number',
  'contacts', // At least one contact
];

// All trackable fields for completion percentage
const ALL_FIELDS = [
  'first_name',
  'last_name',
  'middle_name',
  'date_of_birth',
  'gender',
  'marital_status',
  'nationality',
  'id_type',
  'id_number',
  'street_number',
  'suburb',
  'city',
  'state',
  'country',
  'contacts',
  'next_of_kin.first_name',
  'employer.name',
  'client_limits',
];

class ClientDraftService {
  /**
   * Check if required fields are complete
   */
  private checkRequiredFieldsComplete(data: Record<string, any>): boolean {
    for (const field of REQUIRED_FIELDS) {
      if (field === 'contacts') {
        // Check if at least one contact exists with a phone number
        if (
          !data.contacts ||
          !Array.isArray(data.contacts) ||
          data.contacts.length === 0
        ) {
          return false;
        }
        const hasValidContact = data.contacts.some(
          (c: any) => c.phone && c.phone.trim().length > 0
        );
        if (!hasValidContact) return false;
      } else {
        const value = data[field];
        if (value === undefined || value === null || value === '') {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Calculate completion percentage
   */
  private calculateCompletionPercentage(data: Record<string, any>): number {
    let filledFields = 0;

    for (const fieldPath of ALL_FIELDS) {
      if (fieldPath.includes('.')) {
        // Nested field
        const [parent, child] = fieldPath.split('.');
        if (data[parent] && data[parent][child]) {
          filledFields++;
        }
      } else if (fieldPath === 'contacts') {
        if (
          data.contacts &&
          Array.isArray(data.contacts) &&
          data.contacts.length > 0
        ) {
          filledFields++;
        }
      } else if (fieldPath === 'client_limits') {
        if (
          data.client_limits &&
          Array.isArray(data.client_limits) &&
          data.client_limits.length > 0
        ) {
          filledFields++;
        }
      } else {
        const value = data[fieldPath];
        if (value !== undefined && value !== null && value !== '') {
          filledFields++;
        }
      }
    }

    return Math.round((filledFields / ALL_FIELDS.length) * 100);
  }

  /**
   * Get draft for current user
   */
  async getDraft(userId: string, organizationId: string) {
    const draft = await prisma.clientDraft.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (!draft) {
      return null;
    }

    // Check if draft has expired
    if (draft.expiresAt && new Date(draft.expiresAt) < new Date()) {
      await this.deleteDraft(userId, organizationId);
      return null;
    }

    return {
      id: draft.id,
      draftData: draft.draftData,
      requiredFieldsComplete: draft.requiredFieldsComplete,
      completionPercentage: draft.completionPercentage,
      lastFieldUpdated: draft.lastFieldUpdated,
      version: draft.version,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }

  /**
   * Save or update draft
   */
  async saveDraft(
    userId: string,
    organizationId: string,
    branchId: string | null,
    draftData: Record<string, any>,
    lastFieldUpdated?: string
  ) {
    const requiredFieldsComplete = this.checkRequiredFieldsComplete(draftData);
    const completionPercentage = this.calculateCompletionPercentage(draftData);

    const draft = await prisma.clientDraft.upsert({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      update: {
        draftData,
        requiredFieldsComplete,
        completionPercentage,
        lastFieldUpdated,
        version: { increment: 1 },
        branchId,
      },
      create: {
        organizationId,
        userId,
        branchId,
        draftData,
        requiredFieldsComplete,
        completionPercentage,
        lastFieldUpdated,
        // Set expiry to 30 days from now
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      id: draft.id,
      draftData: draft.draftData,
      requiredFieldsComplete: draft.requiredFieldsComplete,
      completionPercentage: draft.completionPercentage,
      lastFieldUpdated: draft.lastFieldUpdated,
      version: draft.version,
      updatedAt: draft.updatedAt,
    };
  }

  /**
   * Update a single field in the draft
   */
  async updateDraftField(
    userId: string,
    organizationId: string,
    branchId: string | null,
    fieldPath: string,
    value: any
  ) {
    // Get existing draft or create new one
    let existingDraft = await prisma.clientDraft.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    let draftData: Record<string, any> =
      (existingDraft?.draftData as Record<string, any>) || {};

    // Update the field (supports nested paths like "employer.name")
    if (fieldPath.includes('.')) {
      const parts = fieldPath.split('.');
      let current = draftData;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    } else {
      draftData[fieldPath] = value;
    }

    return this.saveDraft(
      userId,
      organizationId,
      branchId,
      draftData,
      fieldPath
    );
  }

  /**
   * Delete draft (after successful client creation)
   */
  async deleteDraft(userId: string, organizationId: string) {
    try {
      await prisma.clientDraft.delete({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
      });
      return true;
    } catch (error) {
      // Draft might not exist
      return false;
    }
  }

  /**
   * Get all drafts for an organization (admin view)
   */
  async getOrganizationDrafts(organizationId: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [drafts, total] = await Promise.all([
      prisma.clientDraft.findMany({
        where: { organizationId },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.clientDraft.count({ where: { organizationId } }),
    ]);

    return {
      data: drafts.map(draft => ({
        id: draft.id,
        userId: draft.userId,
        completionPercentage: draft.completionPercentage,
        requiredFieldsComplete: draft.requiredFieldsComplete,
        lastFieldUpdated: draft.lastFieldUpdated,
        updatedAt: draft.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Clean up expired drafts (can be called by a cron job)
   */
  async cleanupExpiredDrafts() {
    const result = await prisma.clientDraft.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }
}

export const clientDraftService = new ClientDraftService();
