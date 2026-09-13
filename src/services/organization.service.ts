import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';
import { storageService } from './storage.service';
import { seedDefaultDocumentTypes } from './document-type-defaults';

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

/**
 * Blank out empty optional unique fields.
 *
 * `registrationNumber` and `licenseNumber` carry unique constraints, and an
 * empty string is a value like any other as far as Postgres is concerned - so
 * the first organization saved with `""` claimed it, and every later save of a
 * blank one collided with it. The edit form sends `""` for any field the
 * operator left empty, so this fired on organizations that had nothing to do
 * with each other. NULL is exempt from a unique constraint; empty is not.
 */
function normaliseUniqueFields<T extends Record<string, any>>(data: T): T {
  const cleaned: Record<string, any> = { ...data };

  for (const field of ['registrationNumber', 'licenseNumber', 'email'] as const) {
    if (field in cleaned) {
      const value = cleaned[field];
      if (typeof value === 'string' && value.trim() === '') {
        cleaned[field] = null;
      } else if (typeof value === 'string') {
        cleaned[field] = value.trim();
      }
    }
  }

  return cleaned as T;
}

/**
 * Attach a usable logo URL to an organization.
 *
 * The database stores only the object path inside the bucket; `logoUrl` was
 * declared on the client type but nothing ever filled it, so an organization
 * with a logo still rendered the placeholder icon everywhere. Signing is a
 * local HMAC in the MinIO client - no round trip - so doing it per row is
 * cheap, and a failure just leaves the logo absent rather than failing the
 * whole listing.
 */
async function withLogoUrl<T extends { logo?: string | null }>(
  organization: T
): Promise<T & { logoUrl: string | null }> {
  if (!organization.logo) {
    return { ...organization, logoUrl: null };
  }

  try {
    const logoUrl = await storageService.getSignedUrl(organization.logo);
    return { ...organization, logoUrl };
  } catch (error) {
    console.error('Could not sign organization logo URL:', error);
    return { ...organization, logoUrl: null };
  }
}

const withLogoUrls = <T extends { logo?: string | null }>(items: T[]) =>
  Promise.all(items.map(withLogoUrl));

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
      organizations: await withLogoUrls(organizations),
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
    const organization = await prisma.organization.findUnique({
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

    return organization ? withLogoUrl(organization) : null;
  }

  /**
   * Check if organization with name or email exists
   */
  async exists(name: string, email?: string): Promise<boolean> {
    return !!(await this.findConflict({ name, email }));
  }

  /**
   * Find the organization that blocks this one from being saved, and say which
   * field is to blame.
   *
   * The old `exists()` answered only yes/no, so the caller could say no more
   * than "name or email already exists" - leaving the operator to guess which
   * of the two to change. Every unique field is checked here, in the order a
   * person reads the form, and the first clash is the one reported.
   *
   * `registrationNumber` and `licenseNumber` carry database unique constraints
   * but were never checked, so a clash there escaped as a P2002 and surfaced as
   * "Internal server error".
   */
  async findConflict(
    data: {
      name?: string;
      email?: string;
      registrationNumber?: string;
      licenseNumber?: string;
    },
    excludeId?: string
  ): Promise<{ field: string; label: string; organization: { id: string; name: string } } | null> {
    const candidates: Array<{ field: string; label: string; value?: string }> = [
      { field: 'name', label: 'name', value: data.name },
      { field: 'email', label: 'email address', value: data.email },
      {
        field: 'registrationNumber',
        label: 'registration number',
        value: data.registrationNumber,
      },
      { field: 'licenseNumber', label: 'licence number', value: data.licenseNumber },
    ];

    for (const candidate of candidates) {
      const value = candidate.value?.trim();
      if (!value) continue;

      const where: Prisma.OrganizationWhereInput = {
        [candidate.field]: value,
      } as Prisma.OrganizationWhereInput;

      // On an update, an organization does not conflict with itself.
      if (excludeId) where.NOT = { id: excludeId };

      const organization = await prisma.organization.findFirst({
        where,
        select: { id: true, name: true },
      });

      if (organization) {
        return { field: candidate.field, label: candidate.label, organization };
      }
    }

    return null;
  }

  /**
   * Create a new organization
   */
  async create(data: CreateOrganizationInput) {
    const clean = normaliseUniqueFields(data);

    const organization = await prisma.organization.create({
      data: {
        ...clean,
        isActive: clean.isActive ?? true,
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

    // A document cannot be filed without a type, and a new organization had
    // none - so the first upload on a brand new organization failed with
    // "unknown type". Seeding is additive and never fails the creation.
    try {
      await seedDefaultDocumentTypes(organization.id);
    } catch (error) {
      console.error('Could not seed default document types:', error);
    }

    return organization;
  }

  /**
   * Update an organization
   */
  async update(id: string, data: UpdateOrganizationInput) {
    return prisma.organization.update({
      where: { id },
      data: normaliseUniqueFields(data),
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
