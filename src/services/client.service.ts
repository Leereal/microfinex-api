import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase-enhanced';
import { prisma } from '../config/database';

export interface ClientProfile {
  id: string;
  clientNumber: string;
  type: 'INDIVIDUAL' | 'GROUP' | 'BUSINESS';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  email?: string;
  phone: string;
  dateOfBirth?: Date;
  gender?: string;
  maritalStatus?: string;
  idNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  employmentStatus?: string;
  monthlyIncome?: number;
  creditScore?: number;
  kycStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  kycDocuments?: any;
  organizationId: string;
  branchId: string;
  isActive: boolean;
}

export interface ClientSearchFilters {
  search?: string;
  type?: 'INDIVIDUAL' | 'GROUP' | 'BUSINESS';
  kycStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED';
  isActive?: boolean;
  branchId?: string;
  employmentStatus?: string;
  page?: number;
  limit?: number;
}

export interface KYCDocument {
  type:
    | 'ID_CARD'
    | 'PASSPORT'
    | 'DRIVERS_LICENSE'
    | 'UTILITY_BILL'
    | 'BANK_STATEMENT'
    | 'PAYSLIP'
    | 'OTHER';
  fileName: string;
  fileUrl: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verifiedBy?: string;
  verifiedAt?: Date;
  notes?: string;
}

// Validation schemas
export const createClientSchema = z
  .object({
    type: z.enum(['INDIVIDUAL', 'GROUP', 'BUSINESS']),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    businessName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(10, 'Phone number must be at least 10 characters'),
    dateOfBirth: z.string().datetime().optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    maritalStatus: z
      .enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'])
      .optional(),
    idNumber: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
    employmentStatus: z
      .enum(['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED', 'STUDENT'])
      .optional(),
    monthlyIncome: z.number().min(0).optional(),
    branchId: z.string().uuid(),
  })
  .refine(
    data => {
      if (data.type === 'INDIVIDUAL') {
        return data.firstName && data.lastName;
      }
      if (data.type === 'BUSINESS') {
        return data.businessName;
      }
      return true;
    },
    {
      message:
        'Individual clients must have firstName and lastName, business clients must have businessName',
    }
  );

export const updateClientSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'GROUP', 'BUSINESS']).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  businessName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z
    .string()
    .min(10, 'Phone number must be at least 10 characters')
    .optional(),
  dateOfBirth: z.string().datetime().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  maritalStatus: z
    .enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'])
    .optional(),
  idNumber: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
  employmentStatus: z
    .enum(['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED', 'STUDENT'])
    .optional(),
  monthlyIncome: z.number().min(0).optional(),
  branchId: z.string().uuid().optional(),
});

export const kycDocumentSchema = z.object({
  type: z.enum([
    'ID_CARD',
    'PASSPORT',
    'DRIVERS_LICENSE',
    'UTILITY_BILL',
    'BANK_STATEMENT',
    'PAYSLIP',
    'OTHER',
  ]),
  fileName: z.string().min(1),
  fileUrl: z.string().url(),
  notes: z.string().optional(),
});

class ClientService {
  /**
   * Generate unique client number
   */
  private async generateClientNumber(organizationId: string): Promise<string> {
    const today = new Date();
    const year = today.getFullYear().toString().slice(-2);
    const month = (today.getMonth() + 1).toString().padStart(2, '0');

    // Get count of clients this month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const count = await prisma.client.count({
      where: {
        organizationId,
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    const sequence = (count + 1).toString().padStart(4, '0');
    return `CL${year}${month}${sequence}`;
  }

  /**
   * Create new client
   */
  async createClient(
    clientData: z.infer<typeof createClientSchema>,
    organizationId: string,
    createdBy: string
  ): Promise<ClientProfile> {
    const clientNumber = await this.generateClientNumber(organizationId);

    const client = await prisma.client.create({
      data: {
        ...clientData,
        clientNumber,
        organizationId,
        createdBy,
        creditScore: clientData.monthlyIncome
          ? this.calculateInitialCreditScore(clientData.monthlyIncome)
          : null,
      },
      include: {
        organization: true,
        branch: true,
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    return this.mapClientToProfile(client);
  }

  /**
   * Update client
   */
  async updateClient(
    clientId: string,
    clientData: z.infer<typeof updateClientSchema>,
    organizationId: string
  ): Promise<ClientProfile> {
    const client = await prisma.client.update({
      where: {
        id: clientId,
        organizationId,
      },
      data: {
        ...clientData,
        updatedAt: new Date(),
      },
      include: {
        organization: true,
        branch: true,
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    return this.mapClientToProfile(client);
  }

  /**
   * Get client by ID
   */
  async getClientById(
    clientId: string,
    organizationId: string
  ): Promise<ClientProfile | null> {
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId,
      },
      include: {
        organization: true,
        branch: true,
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        loans: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            status: true,
            outstandingBalance: true,
          },
        },
        employers: {
          include: {
            employer: true,
          },
        },
        nextOfKins: true,
        clientLimits: {
          where: {
            isActive: true,
          },
        },
      },
    });

    return client ? this.mapClientToProfile(client) : null;
  }

  /**
   * Search clients with filters
   */
  async searchClients(
    filters: ClientSearchFilters,
    organizationId: string
  ): Promise<{
    clients: ClientProfile[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      organizationId,
    };

    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { businessName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search } },
        { clientNumber: { contains: filters.search } },
        { idNumber: { contains: filters.search } },
      ];
    }

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.kycStatus) {
      where.kycStatus = filters.kycStatus;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.branchId) {
      where.branchId = filters.branchId;
    }

    if (filters.employmentStatus) {
      where.employmentStatus = filters.employmentStatus;
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: limit,
        include: {
          organization: true,
          branch: true,
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          loans: {
            select: {
              id: true,
              status: true,
              outstandingBalance: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      prisma.client.count({ where }),
    ]);

    return {
      clients: clients.map(client => this.mapClientToProfile(client)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Update KYC status
   */
  async updateKYCStatus(
    clientId: string,
    status: 'PENDING' | 'VERIFIED' | 'REJECTED',
    organizationId: string,
    verifiedBy?: string,
    notes?: string
  ): Promise<ClientProfile> {
    const client = await prisma.client.update({
      where: {
        id: clientId,
        organizationId,
      },
      data: {
        kycStatus: status,
        updatedAt: new Date(),
      },
      include: {
        organization: true,
        branch: true,
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    return this.mapClientToProfile(client);
  }

  /**
   * Add KYC document
   */
  async addKYCDocument(
    clientId: string,
    document: z.infer<typeof kycDocumentSchema>,
    organizationId: string
  ): Promise<ClientProfile> {
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId,
      },
    });

    if (!client) {
      throw new Error('Client not found');
    }

    const existingDocuments =
      (client.kycDocuments as unknown as KYCDocument[]) || [];
    const updatedDocuments = [
      ...existingDocuments,
      {
        ...document,
        verificationStatus: 'PENDING' as const,
        uploadedAt: new Date(),
      },
    ];

    const updatedClient = await prisma.client.update({
      where: {
        id: clientId,
      },
      data: {
        kycDocuments: updatedDocuments as any,
        updatedAt: new Date(),
      },
      include: {
        organization: true,
        branch: true,
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    return this.mapClientToProfile(updatedClient);
  }

  /**
   * Get client statistics
   */
  async getClientStatistics(
    organizationId: string,
    branchId?: string
  ): Promise<{
    total: number;
    active: number;
    individual: number;
    business: number;
    group: number;
    kycPending: number;
    kycVerified: number;
    kycRejected: number;
    averageCreditScore?: number;
  }> {
    const where: any = { organizationId };
    if (branchId) {
      where.branchId = branchId;
    }

    const [
      total,
      active,
      individual,
      business,
      group,
      kycPending,
      kycVerified,
      kycRejected,
      avgCreditScore,
    ] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.count({ where: { ...where, isActive: true } }),
      prisma.client.count({ where: { ...where, type: 'INDIVIDUAL' } }),
      prisma.client.count({ where: { ...where, type: 'BUSINESS' } }),
      prisma.client.count({ where: { ...where, type: 'GROUP' } }),
      prisma.client.count({ where: { ...where, kycStatus: 'PENDING' } }),
      prisma.client.count({ where: { ...where, kycStatus: 'VERIFIED' } }),
      prisma.client.count({ where: { ...where, kycStatus: 'REJECTED' } }),
      prisma.client.aggregate({
        where: {
          ...where,
          creditScore: { not: null },
        },
        _avg: {
          creditScore: true,
        },
      }),
    ]);

    return {
      total,
      active,
      individual,
      business,
      group,
      kycPending,
      kycVerified,
      kycRejected,
      averageCreditScore: avgCreditScore._avg.creditScore || undefined,
    };
  }

  /**
   * Calculate initial credit score based on monthly income
   */
  private calculateInitialCreditScore(monthlyIncome: number): number {
    // Simple credit scoring algorithm
    // This should be replaced with a more sophisticated scoring model
    let score = 300; // Base score

    if (monthlyIncome >= 10000) score += 200;
    else if (monthlyIncome >= 5000) score += 150;
    else if (monthlyIncome >= 2000) score += 100;
    else if (monthlyIncome >= 1000) score += 50;

    // Cap the score at 850
    return Math.min(score, 850);
  }

  /**
   * Map Prisma client to ClientProfile
   */
  private mapClientToProfile(client: any): ClientProfile {
    return {
      id: client.id,
      clientNumber: client.clientNumber,
      type: client.type,
      firstName: client.firstName,
      lastName: client.lastName,
      businessName: client.businessName,
      email: client.email,
      phone: client.phone,
      dateOfBirth: client.dateOfBirth,
      gender: client.gender,
      maritalStatus: client.maritalStatus,
      idNumber: client.idNumber,
      address: client.address,
      city: client.city,
      state: client.state,
      zipCode: client.zipCode,
      country: client.country,
      employmentStatus: client.employmentStatus,
      monthlyIncome: client.monthlyIncome
        ? parseFloat(client.monthlyIncome.toString())
        : undefined,
      creditScore: client.creditScore,
      kycStatus: client.kycStatus,
      kycDocuments: client.kycDocuments,
      organizationId: client.organizationId,
      branchId: client.branchId,
      isActive: client.isActive,
    };
  }
}

export const clientService = new ClientService();
