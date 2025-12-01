import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';

export interface OrganizationFilters {
  search?: string;
  type?: 'MICROFINANCE' | 'BANK' | 'CREDIT_UNION' | 'COOPERATIVE';
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateOrganizationInput {
  name: string;
  type: 'MICROFINANCE' | 'BANK' | 'CREDIT_UNION' | 'COOPERATIVE';
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  registrationNumber?: string;
  licenseNumber?: string;
  isActive?: boolean;
  apiTier?: 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
  maxApiKeys?: number;
  rateLimit?: number;
}

export interface UpdateOrganizationInput
  extends Partial<CreateOrganizationInput> {}

class OrganizationService {
  /**
   * Get all organizations with filters and pagination
   */
  async findAll(
    filters: OrganizationFilters,
    userOrganizationId?: string | null,
    isSuperAdmin: boolean = false
  ) {
    const { search, type, isActive, page = 1, limit = 10 } = filters;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.OrganizationWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { registrationNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (type) {
      where.type = type;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // Non-super admins can only see their own organization
    if (!isSuperAdmin && userOrganizationId) {
      where.id = userOrganizationId;
    }

    const [organizations, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        skip,
        take: limit,
        include: {
          branches: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              users: true,
              clients: true,
              loans: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.organization.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      organizations,
      pagination: {
        page,
        limit,
        total,
        pages: totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get organization by ID
   */
  async findById(id: string) {
    return prisma.organization.findUnique({
      where: { id },
      include: {
        branches: {
          include: {
            _count: {
              select: {
                users: true,
                clients: true,
              },
            },
          },
        },
        _count: {
          select: {
            users: true,
            clients: true,
            loans: true,
            apiKeys: true,
          },
        },
      },
    });
  }

  /**
   * Check if organization with name or email exists
   */
  async exists(name: string, email?: string): Promise<boolean> {
    const conditions: Prisma.OrganizationWhereInput[] = [{ name }];
    if (email) {
      conditions.push({ email });
    }

    const existing = await prisma.organization.findFirst({
      where: { OR: conditions },
    });

    return !!existing;
  }

  /**
   * Create a new organization
   */
  async create(data: CreateOrganizationInput) {
    return prisma.organization.create({
      data: {
        ...data,
        isActive: data.isActive ?? true,
      },
      include: {
        _count: {
          select: {
            users: true,
            clients: true,
            loans: true,
          },
        },
      },
    });
  }

  /**
   * Update an organization
   */
  async update(id: string, data: UpdateOrganizationInput) {
    return prisma.organization.update({
      where: { id },
      data,
      include: {
        _count: {
          select: {
            users: true,
            clients: true,
            loans: true,
          },
        },
      },
    });
  }

  /**
   * Update organization status
   */
  async updateStatus(id: string, isActive: boolean) {
    return prisma.organization.update({
      where: { id },
      data: { isActive },
    });
  }

  /**
   * Delete organization (soft delete by setting isActive to false)
   */
  async delete(id: string) {
    return prisma.organization.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Get organization statistics
   */
  async getStatistics(organizationId: string) {
    const [totalUsers, totalClients, totalLoans, totalBranches, activeLoans] =
      await Promise.all([
        prisma.user.count({ where: { organizationId } }),
        prisma.client.count({ where: { organizationId } }),
        prisma.loan.count({ where: { organizationId } }),
        prisma.branch.count({ where: { organizationId } }),
        prisma.loan.count({ where: { organizationId, status: 'ACTIVE' } }),
      ]);

    return {
      totalUsers,
      totalClients,
      totalLoans,
      totalBranches,
      activeLoans,
    };
  }
}

export const organizationService = new OrganizationService();
