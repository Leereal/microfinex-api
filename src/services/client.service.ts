import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase-enhanced';
import { prisma } from '../config/database';
import { LoanStatus } from '@prisma/client';

export interface ClientAddress {
  id: string;
  addressType: string;
  addressLine1: string;
  addressLine2?: string;
  suburb?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  isPrimary: boolean;
  notes?: string;
}

export interface ClientContact {
  id: string;
  contactType: string;
  contactValue: string;
  label?: string;
  isPrimary: boolean;
  isWhatsApp: boolean;
  notes?: string;
}

export interface NextOfKin {
  id: string;
  name: string;
  relationship: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface ClientEmployer {
  id: string;
  employerName: string;
  position?: string;
  startDate?: Date;
  endDate?: Date;
  isCurrent: boolean;
  monthlyIncome?: number;
  employerPhone?: string;
  employerAddress?: string;
}

export interface ClientLimit {
  id: string;
  currency: string;
  maxAmount: number;
  usedAmount: number;
  availableAmount: number;
  isActive: boolean;
}

export interface ClientProfile {
  id: string;
  clientNumber: string;
  type: 'INDIVIDUAL' | 'GROUP' | 'BUSINESS';
  title?: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  email?: string;
  phone: string;
  dateOfBirth?: Date;
  gender?: string;
  maritalStatus?: string;
  nationality?: string;
  placeOfBirth?: string;
  // Identification
  idType?: string;
  idNumber?: string;
  passportNumber?: string;
  passportCountry?: string;
  idIssueDate?: Date;
  idExpiryDate?: Date;
  issuingAuthority?: string;
  // Address
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
  homeBranchId?: string;
  isActive: boolean;
  profileImage?: string;
  thumbprintImage?: string;
  signatureImage?: string;
  // Branch details
  branch?: {
    id: string;
    name: string;
    code?: string;
  };
  // Creator details
  createdBy?: string;
  creator?: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
  // Related data
  addresses?: ClientAddress[];
  contacts?: ClientContact[];
  nextOfKins?: NextOfKin[];
  employers?: ClientEmployer[];
  limits?: ClientLimit[];
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
    title: z.enum(['MR', 'MRS', 'MS', 'MISS', 'DR', 'PROF']).optional(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    businessName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(9, 'Phone number must be at least 9 characters'),
    dateOfBirth: z.string().datetime().optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    maritalStatus: z
      .enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED'])
      .optional(),
    nationality: z.string().optional().default('Zimbabwean'),
    placeOfBirth: z.string().optional(),
    // Identification fields
    idType: z
      .enum(['national_id', 'passport', 'drivers_license'])
      .optional()
      .default('national_id'),
    idNumber: z.string().optional(),
    passportNumber: z.string().optional(),
    passportCountry: z.string().optional(),
    idIssueDate: z.string().datetime().optional(),
    idExpiryDate: z.string().datetime().optional(),
    issuingAuthority: z.string().optional(),
    // Address fields
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
    employmentStatus: z
      .enum([
        'EMPLOYED',
        'SELF_EMPLOYED',
        'UNEMPLOYED',
        'RETIRED',
        'STUDENT',
        'HOMEMAKER',
      ])
      .optional(),
    monthlyIncome: z.number().min(0).optional(),
    // Profile images
    profileImage: z.string().optional(),
    thumbprintImage: z.string().optional(),
    signatureImage: z.string().optional(),
    branchId: z.string().uuid(),
    homeBranchId: z.string().uuid().optional(),
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
  title: z
    .enum(['MR', 'MRS', 'MS', 'MISS', 'DR', 'PROF'])
    .optional()
    .nullable(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  businessName: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  phone: z
    .string()
    .min(9, 'Phone number must be at least 9 characters')
    .optional(),
  dateOfBirth: z.string().datetime().optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  maritalStatus: z
    .enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED'])
    .optional()
    .nullable(),
  nationality: z.string().optional().nullable(),
  placeOfBirth: z.string().optional().nullable(),
  // Identification fields
  idType: z
    .enum(['national_id', 'passport', 'drivers_license'])
    .optional()
    .nullable(),
  idNumber: z.string().optional().nullable(),
  passportNumber: z.string().optional().nullable(),
  passportCountry: z.string().optional().nullable(),
  idIssueDate: z.string().datetime().optional().nullable(),
  idExpiryDate: z.string().datetime().optional().nullable(),
  issuingAuthority: z.string().optional().nullable(),
  // Address fields
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zipCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  employmentStatus: z
    .enum([
      'EMPLOYED',
      'SELF_EMPLOYED',
      'UNEMPLOYED',
      'RETIRED',
      'STUDENT',
      'HOMEMAKER',
    ])
    .optional()
    .nullable(),
  monthlyIncome: z.number().min(0).optional().nullable(),
  // Profile images
  profileImage: z.string().optional().nullable(),
  thumbprintImage: z.string().optional().nullable(),
  signatureImage: z.string().optional().nullable(),
  branchId: z.string().uuid().optional(),
  homeBranchId: z.string().uuid().optional().nullable(),
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
    // Check for duplicate phone number within the organization
    if (clientData.phone) {
      const existingByPhone = await prisma.client.findFirst({
        where: {
          organizationId,
          phone: clientData.phone,
        },
      });

      if (existingByPhone) {
        const clientName =
          existingByPhone.firstName && existingByPhone.lastName
            ? `${existingByPhone.firstName} ${existingByPhone.lastName}`
            : existingByPhone.businessName || 'Unknown';
        throw new Error(
          `A client with this phone number already exists: ${clientName} (${existingByPhone.clientNumber})`
        );
      }
    }

    // Check for duplicate ID number (globally unique, not per organization)
    if (clientData.idNumber) {
      const existingByIdNumber = await prisma.client.findFirst({
        where: {
          idNumber: clientData.idNumber,
        },
      });

      if (existingByIdNumber) {
        const clientName =
          existingByIdNumber.firstName && existingByIdNumber.lastName
            ? `${existingByIdNumber.firstName} ${existingByIdNumber.lastName}`
            : existingByIdNumber.businessName || 'Unknown';
        throw new Error(
          `A client with this ID number already exists: ${clientName} (${existingByIdNumber.clientNumber})`
        );
      }
    }

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
        addresses: true,
        contacts: true,
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
      title: client.title,
      firstName: client.firstName,
      lastName: client.lastName,
      businessName: client.businessName,
      email: client.email,
      phone: client.phone,
      dateOfBirth: client.dateOfBirth,
      gender: client.gender,
      maritalStatus: client.maritalStatus,
      nationality: client.nationality,
      placeOfBirth: client.placeOfBirth,
      // Identification
      idType: client.idType,
      idNumber: client.idNumber,
      passportNumber: client.passportNumber,
      passportCountry: client.passportCountry,
      idIssueDate: client.idIssueDate,
      idExpiryDate: client.idExpiryDate,
      issuingAuthority: client.issuingAuthority,
      // Address
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
      homeBranchId: client.homeBranchId,
      isActive: client.isActive,
      profileImage: client.profileImage,
      thumbprintImage: client.thumbprintImage,
      signatureImage: client.signatureImage,
      // Include branch details if available
      branch: client.branch
        ? {
            id: client.branch.id,
            name: client.branch.name,
            code: client.branch.code,
          }
        : undefined,
      // Include creator details if available
      createdBy: client.createdBy,
      creator: client.creator
        ? {
            id: client.creator.id,
            firstName: client.creator.firstName,
            lastName: client.creator.lastName,
            email: client.creator.email,
          }
        : undefined,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      // Include addresses and contacts if available
      addresses: client.addresses?.map((addr: any) => ({
        id: addr.id,
        addressType: addr.addressType,
        addressLine1: addr.addressLine1,
        addressLine2: addr.addressLine2,
        suburb: addr.suburb,
        city: addr.city,
        state: addr.state,
        zipCode: addr.zipCode,
        country: addr.country,
        isPrimary: addr.isPrimary,
        notes: addr.notes,
      })),
      contacts: client.contacts?.map((contact: any) => ({
        id: contact.id,
        contactType: contact.contactType,
        contactValue: contact.contactValue,
        label: contact.label,
        isPrimary: contact.isPrimary,
        isWhatsApp: contact.isWhatsApp,
        notes: contact.notes,
      })),
      nextOfKins: client.nextOfKins?.map((kin: any) => ({
        id: kin.id,
        name: kin.name,
        relationship: kin.relationship,
        phone: kin.phone,
        email: kin.email,
        address: kin.address,
      })),
      employers: client.employers?.map((emp: any) => ({
        id: emp.id,
        employerName: emp.employer?.name || emp.employerName,
        position: emp.position,
        startDate: emp.startDate,
        endDate: emp.endDate,
        isCurrent: emp.isCurrent,
        monthlyIncome: emp.monthlyIncome
          ? parseFloat(emp.monthlyIncome.toString())
          : undefined,
        employerPhone: emp.employer?.phone,
        employerAddress: emp.employer?.address,
      })),
      limits: client.clientLimits?.map((limit: any) => ({
        id: limit.id,
        currency: limit.currency,
        maxAmount: parseFloat(limit.maxAmount?.toString() || '0'),
        usedAmount: parseFloat(limit.usedAmount?.toString() || '0'),
        availableAmount: parseFloat(limit.availableAmount?.toString() || '0'),
        isActive: limit.isActive,
      })),
    };
  }

  /**
   * Delete (soft delete) a client
   * Sets isActive to false instead of actually deleting
   */
  async deleteClient(
    clientId: string,
    organizationId: string
  ): Promise<ClientProfile> {
    // Check if client has active loans
    const activeLoans = await prisma.loan.count({
      where: {
        clientId,
        status: {
          in: [
            LoanStatus.ACTIVE,
            LoanStatus.PENDING,
            LoanStatus.PENDING_ASSESSMENT,
            LoanStatus.PENDING_VISIT,
            LoanStatus.PENDING_APPROVAL,
            LoanStatus.APPROVED,
            LoanStatus.PENDING_DISBURSEMENT,
          ],
        },
      },
    });

    if (activeLoans > 0) {
      throw new Error('Cannot delete client with active loans');
    }

    const client = await prisma.client.update({
      where: {
        id: clientId,
        organizationId,
      },
      data: {
        isActive: false,
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
   * Get all clients across all organizations (Super Admin only)
   */
  async getAllClientsGlobal(filters: {
    search?: string;
    organizationId?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    clients: (ClientProfile & { organizationName?: string })[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};

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

    if (filters.organizationId) {
      where.organizationId = filters.organizationId;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: limit,
        include: {
          contacts: true,
          addresses: true,
          nextOfKins: true,
          employers: true,
          clientLimits: true,
          documents: true,
          branch: { select: { id: true, name: true } },
          creator: { select: { firstName: true, lastName: true } },
          organization: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.client.count({ where }),
    ]);

    return {
      clients: clients.map(client => ({
        ...this.mapClientToProfile(client),
        organizationName: (client as any).organization?.name,
        organizationId: client.organizationId,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Permanently delete a client for Super Admin (can delete from any organization)
   */
  async permanentlyDeleteClientGlobal(clientId: string): Promise<void> {
    // Check if client has any loans
    const loans = await prisma.loan.count({
      where: { clientId },
    });

    if (loans > 0) {
      throw new Error('Cannot permanently delete client with loan history');
    }

    // Delete related records first
    await prisma.$transaction([
      prisma.clientContact.deleteMany({ where: { clientId } }),
      prisma.clientAddress.deleteMany({ where: { clientId } }),
      prisma.nextOfKin.deleteMany({ where: { clientId } }),
      prisma.clientEmployer.deleteMany({ where: { clientId } }),
      prisma.clientLimit.deleteMany({ where: { clientId } }),
      prisma.clientDocument.deleteMany({ where: { clientId } }),
      prisma.client.delete({ where: { id: clientId } }),
    ]);
  }

  /**
   * Bulk permanently delete clients for Super Admin
   */
  async bulkPermanentlyDeleteClientsGlobal(
    clientIds: string[]
  ): Promise<{ deleted: string[]; failed: { id: string; reason: string }[] }> {
    const deleted: string[] = [];
    const failed: { id: string; reason: string }[] = [];

    for (const clientId of clientIds) {
      try {
        // Check if client exists and is inactive
        const client = await prisma.client.findUnique({
          where: { id: clientId },
          select: { id: true, isActive: true },
        });

        if (!client) {
          failed.push({ id: clientId, reason: 'Client not found' });
          continue;
        }

        if (client.isActive) {
          failed.push({ id: clientId, reason: 'Client is still active' });
          continue;
        }

        // Check for loans
        const loans = await prisma.loan.count({ where: { clientId } });
        if (loans > 0) {
          failed.push({ id: clientId, reason: 'Client has loan history' });
          continue;
        }

        // Delete
        await this.permanentlyDeleteClientGlobal(clientId);
        deleted.push(clientId);
      } catch (error: any) {
        failed.push({ id: clientId, reason: error.message || 'Unknown error' });
      }
    }

    return { deleted, failed };
  }

  /**
   * Permanently delete a client (use with caution)
   * Only for clients with no loans and no documents
   */
  async permanentlyDeleteClient(
    clientId: string,
    organizationId: string
  ): Promise<void> {
    // Check if client has any loans
    const loans = await prisma.loan.count({
      where: { clientId },
    });

    if (loans > 0) {
      throw new Error('Cannot permanently delete client with loan history');
    }

    // Delete related records first
    await prisma.$transaction([
      prisma.clientContact.deleteMany({ where: { clientId } }),
      prisma.clientAddress.deleteMany({ where: { clientId } }),
      prisma.nextOfKin.deleteMany({ where: { clientId } }),
      prisma.clientEmployer.deleteMany({ where: { clientId } }),
      prisma.clientLimit.deleteMany({ where: { clientId } }),
      prisma.clientDocument.deleteMany({ where: { clientId } }),
      prisma.client.delete({
        where: {
          id: clientId,
          organizationId,
        },
      }),
    ]);
  }
}

export const clientService = new ClientService();
