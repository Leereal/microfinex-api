import { prisma } from '../config/database';
import { LoanStatus, VisitType } from '@prisma/client';

// ============================================
// LOAN ASSESSMENT SERVICE
// ============================================

interface CreateAssessmentInput {
  loanId: string;
  assessorId: string;
  documentChecklist?: Record<string, boolean>;
  notes?: string;
}

interface UpdateAssessmentInput {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  documentChecklist?: Record<string, boolean>;
  notes?: string;
}

class LoanAssessmentService {
  async create(input: CreateAssessmentInput) {
    return prisma.loanAssessment.create({
      data: {
        loanId: input.loanId,
        assessorId: input.assessorId,
        status: 'PENDING',
        documentChecklist: input.documentChecklist || {},
        notes: input.notes,
      },
      include: {
        loan: {
          select: { loanNumber: true, amount: true, status: true },
        },
        assessor: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async update(id: string, input: UpdateAssessmentInput) {
    const updateData: any = { ...input };

    if (input.status === 'APPROVED' || input.status === 'REJECTED') {
      updateData.completedAt = new Date();
    }

    return prisma.loanAssessment.update({
      where: { id },
      data: updateData,
      include: {
        loan: {
          select: { loanNumber: true, amount: true, status: true },
        },
        assessor: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async get(id: string) {
    return prisma.loanAssessment.findUnique({
      where: { id },
      include: {
        loan: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            status: true,
            client: {
              select: { firstName: true, lastName: true, phone: true },
            },
          },
        },
        assessor: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async getByLoan(loanId: string) {
    return prisma.loanAssessment.findMany({
      where: { loanId },
      include: {
        assessor: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPendingAssessments(assessorId?: string) {
    return prisma.loanAssessment.findMany({
      where: {
        status: 'PENDING',
        ...(assessorId && { assessorId }),
      },
      include: {
        loan: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            client: {
              select: { firstName: true, lastName: true, phone: true },
            },
          },
        },
        assessor: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async delete(id: string) {
    return prisma.loanAssessment.delete({
      where: { id },
    });
  }
}

// ============================================
// LOAN VISIT SERVICE
// ============================================

interface CreateVisitInput {
  loanId: string;
  visitType: VisitType;
  address?: string;
  gpsLat?: number;
  gpsLng?: number;
  visitedBy: string;
  visitedAt?: Date;
  images?: string[];
  notes?: string;
}

interface UpdateVisitInput {
  address?: string;
  gpsLat?: number;
  gpsLng?: number;
  visitedAt?: Date;
  images?: string[];
  notes?: string;
  syncedAt?: Date;
}

class LoanVisitService {
  async create(input: CreateVisitInput) {
    return prisma.loanVisit.create({
      data: {
        loanId: input.loanId,
        visitType: input.visitType,
        address: input.address,
        gpsLat: input.gpsLat,
        gpsLng: input.gpsLng,
        visitedBy: input.visitedBy,
        visitedAt: input.visitedAt,
        images: input.images || [],
        notes: input.notes,
      },
      include: {
        loan: {
          select: { loanNumber: true, amount: true },
        },
        visitor: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async update(id: string, input: UpdateVisitInput) {
    return prisma.loanVisit.update({
      where: { id },
      data: input,
      include: {
        loan: {
          select: { loanNumber: true, amount: true },
        },
        visitor: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async get(id: string) {
    return prisma.loanVisit.findUnique({
      where: { id },
      include: {
        loan: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            client: {
              select: {
                firstName: true,
                lastName: true,
                phone: true,
                address: true,
              },
            },
          },
        },
        visitor: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async getByLoan(loanId: string) {
    return prisma.loanVisit.findMany({
      where: { loanId },
      include: {
        visitor: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPendingVisits(userId?: string) {
    return prisma.loanVisit.findMany({
      where: {
        visitedAt: null,
        ...(userId && { visitedBy: userId }),
      },
      include: {
        loan: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            client: {
              select: {
                firstName: true,
                lastName: true,
                phone: true,
                address: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async syncVisit(id: string, data: UpdateVisitInput) {
    return prisma.loanVisit.update({
      where: { id },
      data: {
        ...data,
        syncedAt: new Date(),
      },
    });
  }

  async delete(id: string) {
    return prisma.loanVisit.delete({
      where: { id },
    });
  }
}

// ============================================
// SECURITY PLEDGE SERVICE
// ============================================

interface CreatePledgeInput {
  loanId: string;
  itemDescription: string;
  serialNumber?: string;
  estimatedValue: number;
  currency?: 'ZWG' | 'USD' | 'ZAR';
  images?: string[];
}

interface UpdatePledgeInput {
  itemDescription?: string;
  serialNumber?: string;
  estimatedValue?: number;
  currency?: 'ZWG' | 'USD' | 'ZAR';
  images?: string[];
  status?: 'PENDING' | 'VERIFIED' | 'RELEASED' | 'SEIZED';
}

class SecurityPledgeService {
  async create(input: CreatePledgeInput) {
    return prisma.securityPledge.create({
      data: {
        loanId: input.loanId,
        itemDescription: input.itemDescription,
        serialNumber: input.serialNumber,
        estimatedValue: input.estimatedValue,
        currency: input.currency || 'USD',
        images: input.images || [],
        status: 'PENDING',
      },
      include: {
        loan: {
          select: { loanNumber: true, amount: true },
        },
      },
    });
  }

  async update(id: string, input: UpdatePledgeInput) {
    return prisma.securityPledge.update({
      where: { id },
      data: input,
      include: {
        loan: {
          select: { loanNumber: true, amount: true },
        },
      },
    });
  }

  async get(id: string) {
    return prisma.securityPledge.findUnique({
      where: { id },
      include: {
        loan: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            status: true,
            client: {
              select: { firstName: true, lastName: true, phone: true },
            },
          },
        },
      },
    });
  }

  async getByLoan(loanId: string) {
    return prisma.securityPledge.findMany({
      where: { loanId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async verifyPledge(id: string) {
    return prisma.securityPledge.update({
      where: { id },
      data: { status: 'VERIFIED' },
    });
  }

  async releasePledge(id: string) {
    return prisma.securityPledge.update({
      where: { id },
      data: { status: 'RELEASED' },
    });
  }

  async seizePledge(id: string) {
    return prisma.securityPledge.update({
      where: { id },
      data: { status: 'SEIZED' },
    });
  }

  async delete(id: string) {
    return prisma.securityPledge.delete({
      where: { id },
    });
  }

  async getTotalPledgeValue(loanId: string) {
    const pledges = await prisma.securityPledge.findMany({
      where: { loanId },
      select: { estimatedValue: true },
    });
    return pledges.reduce((sum, p) => sum + Number(p.estimatedValue), 0);
  }
}

// ============================================
// LOAN WORKFLOW HISTORY SERVICE
// ============================================

interface CreateWorkflowHistoryInput {
  loanId: string;
  fromStatus: LoanStatus;
  toStatus: LoanStatus;
  changedBy: string;
  notes?: string;
}

class LoanWorkflowHistoryService {
  async create(input: CreateWorkflowHistoryInput) {
    return prisma.loanWorkflowHistory.create({
      data: {
        loanId: input.loanId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        changedBy: input.changedBy,
        notes: input.notes,
      },
      include: {
        changer: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async getByLoan(loanId: string) {
    return prisma.loanWorkflowHistory.findMany({
      where: { loanId },
      include: {
        changer: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { changedAt: 'desc' },
    });
  }

  async getRecentChanges(organizationId: string, limit: number = 50) {
    return prisma.loanWorkflowHistory.findMany({
      where: {
        loan: { organizationId },
      },
      include: {
        loan: {
          select: { loanNumber: true },
        },
        changer: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { changedAt: 'desc' },
      take: limit,
    });
  }
}

// ============================================
// LOAN STATUS TRANSITION SERVICE
// ============================================

class LoanStatusTransitionService {
  private workflowHistory = new LoanWorkflowHistoryService();

  private validTransitions: Record<LoanStatus, LoanStatus[]> = {
    DRAFT: ['PENDING', 'CANCELLED'],
    PENDING: [
      'PENDING_ASSESSMENT',
      'PENDING_VISIT',
      'PENDING_APPROVAL',
      'CANCELLED',
    ],
    PENDING_ASSESSMENT: ['PENDING_VISIT', 'PENDING_APPROVAL', 'CANCELLED'],
    PENDING_VISIT: ['PENDING_APPROVAL', 'CANCELLED'],
    PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
    APPROVED: ['PENDING_DISBURSEMENT', 'CANCELLED'],
    PENDING_DISBURSEMENT: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['COMPLETED', 'OVERDUE', 'DEFAULTED', 'WRITTEN_OFF'],
    OVERDUE: ['ACTIVE', 'COMPLETED', 'DEFAULTED', 'WRITTEN_OFF'],
    COMPLETED: [],
    CANCELLED: [],
    DEFAULTED: ['WRITTEN_OFF'],
    WRITTEN_OFF: [],
  };

  isValidTransition(from: LoanStatus, to: LoanStatus): boolean {
    return this.validTransitions[from]?.includes(to) ?? false;
  }

  getNextStatuses(currentStatus: LoanStatus): LoanStatus[] {
    return this.validTransitions[currentStatus] || [];
  }

  async transitionLoanStatus(
    loanId: string,
    toStatus: LoanStatus,
    changedBy: string,
    notes?: string
  ) {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      select: { status: true },
    });

    if (!loan) {
      throw new Error('Loan not found');
    }

    if (!this.isValidTransition(loan.status, toStatus)) {
      throw new Error(
        `Invalid status transition from ${loan.status} to ${toStatus}`
      );
    }

    // Update loan status and record history
    const [updatedLoan] = await prisma.$transaction([
      prisma.loan.update({
        where: { id: loanId },
        data: { status: toStatus },
      }),
      prisma.loanWorkflowHistory.create({
        data: {
          loanId,
          fromStatus: loan.status,
          toStatus,
          changedBy,
          notes,
        },
      }),
    ]);

    return updatedLoan;
  }
}

// Export services
export const loanAssessmentService = new LoanAssessmentService();
export const loanVisitService = new LoanVisitService();
export const securityPledgeService = new SecurityPledgeService();
export const loanWorkflowHistoryService = new LoanWorkflowHistoryService();
export const loanStatusTransitionService = new LoanStatusTransitionService();
