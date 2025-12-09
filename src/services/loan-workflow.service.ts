import { prisma } from '../config/database';
import { LoanStatus, VisitType, LoanCategory, Prisma } from '@prisma/client';
import { financialTransactionService } from './financial-transaction.service';
import { chargeService } from './charge.service';

// ============================================
// WORKFLOW STEP REQUIREMENTS
// ============================================

interface WorkflowRequirements {
  requiresAssessment: boolean;
  requiresBusinessVisit: boolean;
  requiresHomeVisit: boolean;
  requiresSecurityPledge: boolean;
  requiresCollateral: boolean;
  isLongTerm: boolean;
}

interface WorkflowStatus {
  loanId: string;
  currentStatus: LoanStatus;
  requirements: WorkflowRequirements;
  completedSteps: {
    assessment: boolean;
    businessVisit: boolean;
    homeVisit: boolean;
    securityPledge: boolean;
    collateral: boolean;
  };
  nextAllowedStatuses: LoanStatus[];
  missingRequirements: string[];
  canAdvance: boolean;
}

// ============================================
// LOAN ASSESSMENT SERVICE
// ============================================

interface CreateAssessmentInput {
  loanId: string;
  assessorId: string;
  // 5C's Assessment
  clientCharacter?: 'GOOD' | 'FAIR' | 'POOR';
  clientCapacity?: 'ADEQUATE' | 'MARGINAL' | 'INADEQUATE';
  collateralQuality?: 'SATISFACTORY' | 'FAIR' | 'POOR';
  conditions?: 'FAVORABLE' | 'MODERATE' | 'UNFAVORABLE';
  capitalAdequacy?: 'ADEQUATE' | 'MARGINAL' | 'INADEQUATE';
  // Assessment Results
  recommendedAmount?: number;
  recommendation?: 'APPROVED' | 'CONDITIONAL' | 'REJECTED';
  // Assessment Documents
  documentChecklist?: Record<string, boolean>;
  notes?: string;
}

interface UpdateAssessmentInput {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  // 5C's Assessment
  clientCharacter?: 'GOOD' | 'FAIR' | 'POOR';
  clientCapacity?: 'ADEQUATE' | 'MARGINAL' | 'INADEQUATE';
  collateralQuality?: 'SATISFACTORY' | 'FAIR' | 'POOR';
  conditions?: 'FAVORABLE' | 'MODERATE' | 'UNFAVORABLE';
  capitalAdequacy?: 'ADEQUATE' | 'MARGINAL' | 'INADEQUATE';
  // Assessment Results
  recommendedAmount?: number;
  recommendation?: 'APPROVED' | 'CONDITIONAL' | 'REJECTED';
  // Assessment Documents
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
        clientCharacter: input.clientCharacter,
        clientCapacity: input.clientCapacity,
        collateralQuality: input.collateralQuality,
        conditions: input.conditions,
        capitalAdequacy: input.capitalAdequacy,
        recommendedAmount: input.recommendedAmount
          ? parseFloat(input.recommendedAmount.toString())
          : undefined,
        recommendation: input.recommendation,
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

// ============================================
// CATEGORY-AWARE WORKFLOW ENGINE
// ============================================

class CategoryAwareWorkflowEngine {
  private statusTransition = new LoanStatusTransitionService();
  private workflowHistory = new LoanWorkflowHistoryService();

  /**
   * Get workflow requirements from loan category
   */
  async getWorkflowRequirements(loanId: string): Promise<WorkflowRequirements> {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        product: {
          include: {
            category: true,
          },
        },
      },
    });

    if (!loan) {
      throw new Error('Loan not found');
    }

    const category = loan.product?.category;

    return {
      requiresAssessment: true, // All loans require assessment
      requiresBusinessVisit: category?.requiresBusinessVisit ?? false,
      requiresHomeVisit: category?.requiresHomeVisit ?? false,
      requiresSecurityPledge: category?.requiresSecurityPledge ?? false,
      requiresCollateral: category?.requiresCollateral ?? false,
      isLongTerm: category?.isLongTerm ?? false,
    };
  }

  /**
   * Get completed workflow steps for a loan
   */
  async getCompletedSteps(
    loanId: string
  ): Promise<WorkflowStatus['completedSteps']> {
    const [assessments, visits, pledges] = await Promise.all([
      prisma.loanAssessment.findMany({
        where: { loanId },
        select: { status: true },
      }),
      prisma.loanVisit.findMany({
        where: { loanId, visitedAt: { not: null } },
        select: { visitType: true },
      }),
      prisma.securityPledge.findMany({
        where: { loanId },
        select: { status: true },
      }),
    ]);

    const hasApprovedAssessment = assessments.some(
      a => a.status === 'APPROVED'
    );
    const hasCompletedBusinessVisit = visits.some(
      v => v.visitType === 'BUSINESS'
    );
    const hasCompletedHomeVisit = visits.some(v => v.visitType === 'HOME');
    const hasVerifiedPledge = pledges.some(p => p.status === 'VERIFIED');

    return {
      assessment: hasApprovedAssessment,
      businessVisit: hasCompletedBusinessVisit,
      homeVisit: hasCompletedHomeVisit,
      securityPledge: hasVerifiedPledge,
      collateral: hasVerifiedPledge, // Same as security pledge for now
    };
  }

  /**
   * Get full workflow status for a loan
   */
  async getWorkflowStatus(loanId: string): Promise<WorkflowStatus> {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      select: { id: true, status: true },
    });

    if (!loan) {
      throw new Error('Loan not found');
    }

    const requirements = await this.getWorkflowRequirements(loanId);
    const completedSteps = await this.getCompletedSteps(loanId);

    // Determine missing requirements
    const missingRequirements: string[] = [];

    if (requirements.requiresAssessment && !completedSteps.assessment) {
      missingRequirements.push('Approved assessment required');
    }
    if (requirements.requiresBusinessVisit && !completedSteps.businessVisit) {
      missingRequirements.push('Business visit required');
    }
    if (requirements.requiresHomeVisit && !completedSteps.homeVisit) {
      missingRequirements.push('Home visit required');
    }
    if (requirements.requiresSecurityPledge && !completedSteps.securityPledge) {
      missingRequirements.push('Verified security pledge required');
    }

    // Determine next allowed statuses based on current status and requirements
    const nextAllowedStatuses = this.getNextStatusesForCategory(
      loan.status,
      requirements,
      completedSteps
    );

    return {
      loanId,
      currentStatus: loan.status,
      requirements,
      completedSteps,
      nextAllowedStatuses,
      missingRequirements,
      canAdvance:
        missingRequirements.length === 0 && nextAllowedStatuses.length > 0,
    };
  }

  /**
   * Get next allowed statuses based on category requirements
   */
  private getNextStatusesForCategory(
    currentStatus: LoanStatus,
    requirements: WorkflowRequirements,
    completedSteps: WorkflowStatus['completedSteps']
  ): LoanStatus[] {
    const baseTransitions =
      this.statusTransition.getNextStatuses(currentStatus);

    // Filter based on requirements
    return baseTransitions.filter(status => {
      switch (status) {
        case 'PENDING_APPROVAL':
          // Can only go to PENDING_APPROVAL if all requirements are met
          if (requirements.requiresAssessment && !completedSteps.assessment)
            return false;
          if (
            requirements.requiresBusinessVisit &&
            !completedSteps.businessVisit
          )
            return false;
          if (requirements.requiresHomeVisit && !completedSteps.homeVisit)
            return false;
          if (
            requirements.requiresSecurityPledge &&
            !completedSteps.securityPledge
          )
            return false;
          return true;

        case 'PENDING_VISIT':
          // Can only go to PENDING_VISIT if assessment is done (when required)
          if (requirements.requiresAssessment && !completedSteps.assessment)
            return false;
          return (
            requirements.requiresBusinessVisit || requirements.requiresHomeVisit
          );

        case 'PENDING_ASSESSMENT':
          // Can always go to assessment if it's a valid base transition
          return true;

        default:
          return true;
      }
    });
  }

  /**
   * Advance loan through workflow with category-aware validation
   */
  async advanceLoan(
    loanId: string,
    toStatus: LoanStatus,
    changedBy: string,
    notes?: string
  ): Promise<{ success: boolean; loan?: any; error?: string }> {
    try {
      const status = await this.getWorkflowStatus(loanId);

      // Validate the transition
      if (!status.nextAllowedStatuses.includes(toStatus)) {
        // Check if it's a base transition issue or requirements issue
        const baseTransitions = this.statusTransition.getNextStatuses(
          status.currentStatus
        );

        if (!baseTransitions.includes(toStatus)) {
          return {
            success: false,
            error: `Invalid status transition from ${status.currentStatus} to ${toStatus}`,
          };
        }

        // It's a requirements issue
        return {
          success: false,
          error: `Cannot transition to ${toStatus}. Missing requirements: ${status.missingRequirements.join(', ')}`,
        };
      }

      // Perform the transition
      const loan = await this.statusTransition.transitionLoanStatus(
        loanId,
        toStatus,
        changedBy,
        notes
      );

      return { success: true, loan };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to advance loan',
      };
    }
  }

  /**
   * Submit loan for assessment
   */
  async submitForAssessment(
    loanId: string,
    assessorId: string,
    changedBy: string,
    notes?: string
  ): Promise<{ assessment: any; loan: any }> {
    // Create the assessment
    const assessment = await loanAssessmentService.create({
      loanId,
      assessorId,
      notes,
    });

    // Transition to PENDING_ASSESSMENT
    const loan = await this.statusTransition.transitionLoanStatus(
      loanId,
      LoanStatus.PENDING_ASSESSMENT,
      changedBy,
      notes || 'Submitted for assessment'
    );

    return { assessment, loan };
  }

  /**
   * Complete assessment and advance workflow
   */
  async completeAssessment(
    assessmentId: string,
    status: 'APPROVED' | 'REJECTED',
    changedBy: string,
    notes?: string
  ): Promise<{ assessment: any; loan?: any }> {
    const assessment = await loanAssessmentService.update(assessmentId, {
      status,
      notes,
    });

    // Get the loan
    const fullAssessment = await loanAssessmentService.get(assessmentId);
    if (!fullAssessment) {
      throw new Error('Assessment not found');
    }

    const loanId = fullAssessment.loan.id;
    const requirements = await this.getWorkflowRequirements(loanId);

    // Determine next status based on requirements
    let nextStatus: LoanStatus;

    if (status === 'REJECTED') {
      nextStatus = LoanStatus.CANCELLED;
    } else if (
      requirements.requiresBusinessVisit ||
      requirements.requiresHomeVisit
    ) {
      nextStatus = LoanStatus.PENDING_VISIT;
    } else if (requirements.requiresSecurityPledge) {
      nextStatus = LoanStatus.PENDING_APPROVAL; // Will be blocked until pledge is verified
    } else {
      nextStatus = LoanStatus.PENDING_APPROVAL;
    }

    const loan = await this.statusTransition.transitionLoanStatus(
      loanId,
      nextStatus,
      changedBy,
      notes || `Assessment ${status.toLowerCase()}`
    );

    return { assessment, loan };
  }

  /**
   * Complete visit and advance workflow
   */
  async completeVisit(
    visitId: string,
    visitData: {
      address?: string;
      gpsLat?: number;
      gpsLng?: number;
      images?: string[];
      notes?: string;
    },
    changedBy: string
  ): Promise<{ visit: any; loan?: any }> {
    const visit = await loanVisitService.update(visitId, {
      ...visitData,
      visitedAt: new Date(),
    });

    // Get the loan
    const fullVisit = await loanVisitService.get(visitId);
    if (!fullVisit) {
      throw new Error('Visit not found');
    }

    const loanId = fullVisit.loan.id;
    const requirements = await this.getWorkflowRequirements(loanId);
    const completedSteps = await this.getCompletedSteps(loanId);

    // Check if all required visits are complete
    const allVisitsComplete =
      (!requirements.requiresBusinessVisit || completedSteps.businessVisit) &&
      (!requirements.requiresHomeVisit || completedSteps.homeVisit);

    if (allVisitsComplete) {
      // Move to next stage
      const loan = await this.statusTransition.transitionLoanStatus(
        loanId,
        LoanStatus.PENDING_APPROVAL,
        changedBy,
        `All required visits completed`
      );
      return { visit, loan };
    }

    return { visit };
  }

  /**
   * Verify pledge and check if loan can advance
   */
  async verifyPledge(
    pledgeId: string,
    changedBy: string,
    notes?: string
  ): Promise<{ pledge: any; canAdvance: boolean; status: WorkflowStatus }> {
    const pledge = await securityPledgeService.verifyPledge(pledgeId);

    const fullPledge = await securityPledgeService.get(pledgeId);
    if (!fullPledge) {
      throw new Error('Pledge not found');
    }

    const status = await this.getWorkflowStatus(fullPledge.loan.id);

    return {
      pledge,
      canAdvance: status.canAdvance,
      status,
    };
  }

  /**
   * Approve loan with all validations
   */
  async approveLoan(
    loanId: string,
    approvedBy: string,
    notes?: string
  ): Promise<{ success: boolean; loan?: any; error?: string }> {
    const status = await this.getWorkflowStatus(loanId);

    if (status.missingRequirements.length > 0) {
      return {
        success: false,
        error: `Cannot approve loan. Missing requirements: ${status.missingRequirements.join(', ')}`,
      };
    }

    return this.advanceLoan(
      loanId,
      LoanStatus.APPROVED,
      approvedBy,
      notes || 'Loan approved'
    );
  }

  /**
   * Reject loan
   */
  async rejectLoan(
    loanId: string,
    rejectedBy: string,
    reason: string
  ): Promise<{ success: boolean; loan?: any; error?: string }> {
    return this.advanceLoan(
      loanId,
      LoanStatus.CANCELLED,
      rejectedBy,
      `Rejected: ${reason}`
    );
  }

  /**
   * Move to pending disbursement
   */
  async markForDisbursement(
    loanId: string,
    changedBy: string,
    notes?: string
  ): Promise<{ success: boolean; loan?: any; error?: string }> {
    return this.advanceLoan(
      loanId,
      LoanStatus.PENDING_DISBURSEMENT,
      changedBy,
      notes || 'Marked for disbursement'
    );
  }

  /**
   * Disburse loan with charges
   */
  async disburseLoan(
    loanId: string,
    disbursedBy: string,
    disbursementDetails?: {
      disbursementDate?: Date;
      disbursementMethod?: string;
      paymentMethodId?: string;
      reference?: string;
      notes?: string;
      chargeIds?: string[]; // Specific charges to apply
      applyMandatoryCharges?: boolean; // Apply mandatory disbursement charges
    }
  ): Promise<{
    success: boolean;
    loan?: any;
    charges?: any;
    netDisbursement?: number;
    error?: string;
  }> {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        organization: { select: { id: true } },
        branch: { select: { id: true } },
        product: { select: { currency: true } },
      },
    });

    if (!loan) {
      return { success: false, error: 'Loan not found' };
    }

    if (
      loan.status !== LoanStatus.PENDING_DISBURSEMENT &&
      loan.status !== LoanStatus.APPROVED
    ) {
      return {
        success: false,
        error: `Loan must be in APPROVED or PENDING_DISBURSEMENT status to disburse. Current status: ${loan.status}`,
      };
    }

    const disbursementDate =
      disbursementDetails?.disbursementDate || new Date();
    const loanAmount = parseFloat(loan.amount.toString());

    // Apply disbursement charges if requested
    let chargesResult = null;
    let netDisbursement = loanAmount;

    if (
      disbursementDetails?.chargeIds?.length ||
      disbursementDetails?.applyMandatoryCharges !== false
    ) {
      try {
        chargesResult = await chargeService.applyDisbursementCharges({
          loanId,
          chargeIds: disbursementDetails?.chargeIds,
          appliedBy: disbursedBy,
          paymentMethodId: disbursementDetails?.paymentMethodId,
        });
        netDisbursement = chargesResult.netDisbursement;
      } catch (error) {
        console.error('Error applying charges:', error);
        // Continue with disbursement even if charges fail
      }
    }

    // Update loan with disbursement details and change status
    const updatedLoan = await prisma.loan.update({
      where: { id: loanId },
      data: {
        status: LoanStatus.ACTIVE,
        disbursedDate: disbursementDate,
      },
    });

    // Create disbursement payment record (net amount after deductions)
    const payment = await prisma.payment.create({
      data: {
        paymentNumber: `DISB-${loan.loanNumber}`,
        loanId,
        amount: netDisbursement, // Net amount after charges deducted from principal
        principalAmount: netDisbursement,
        interestAmount: 0,
        penaltyAmount: 0,
        type: 'LOAN_DISBURSEMENT',
        method: disbursementDetails?.disbursementMethod || 'CASH',
        status: 'COMPLETED',
        paymentDate: disbursementDate,
        receivedBy: disbursedBy,
        transactionRef: disbursementDetails?.reference,
        notes:
          disbursementDetails?.notes ||
          `Loan disbursement via ${disbursementDetails?.disbursementMethod || 'default'}` +
            (chargesResult
              ? ` (Charges: ${chargesResult.totalCharges}, Net: ${netDisbursement})`
              : ''),
      },
    });

    // Create financial transaction for the disbursement (expense) if paymentMethodId is provided
    if (disbursementDetails?.paymentMethodId) {
      await financialTransactionService.recordLoanDisbursement(
        loan.organizationId,
        loan.branchId,
        loanId,
        loan.loanNumber,
        netDisbursement, // Record net disbursement amount
        loan.product?.currency || 'USD',
        disbursementDetails.paymentMethodId,
        disbursedBy
      );
    }

    // Record the transition
    await this.workflowHistory.create({
      loanId,
      fromStatus: loan.status,
      toStatus: LoanStatus.ACTIVE,
      changedBy: disbursedBy,
      notes:
        disbursementDetails?.notes ||
        `Disbursed via ${disbursementDetails?.disbursementMethod || 'default'}` +
          (chargesResult
            ? ` | Charges: ${chargesResult.totalCharges} | Net: ${netDisbursement}`
            : ''),
    });

    return {
      success: true,
      loan: updatedLoan,
      charges: chargesResult,
      netDisbursement,
    };
  }

  /**
   * Get pending disbursements
   * Returns loans that are either APPROVED or PENDING_DISBURSEMENT
   */
  async getPendingDisbursements(organizationId: string, branchId?: string) {
    return prisma.loan.findMany({
      where: {
        organizationId,
        status: {
          in: [LoanStatus.APPROVED, LoanStatus.PENDING_DISBURSEMENT],
        },
        ...(branchId && { branchId }),
      },
      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        product: {
          select: {
            id: true,
            name: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        loanOfficer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { approvedDate: 'asc' },
    });
  }

  /**
   * Batch disburse loans
   */
  async batchDisburse(
    loanIds: string[],
    disbursedBy: string,
    disbursementDetails?: {
      disbursementDate?: Date;
      disbursementMethod?: string;
      paymentMethodId?: string;
      notes?: string;
    }
  ): Promise<{
    success: string[];
    failed: { loanId: string; error: string }[];
  }> {
    const results = {
      success: [] as string[],
      failed: [] as { loanId: string; error: string }[],
    };

    for (const loanId of loanIds) {
      const result = await this.disburseLoan(
        loanId,
        disbursedBy,
        disbursementDetails
      );

      if (result.success) {
        results.success.push(loanId);
      } else {
        results.failed.push({ loanId, error: result.error || 'Unknown error' });
      }
    }

    return results;
  }
}

export const categoryAwareWorkflowEngine = new CategoryAwareWorkflowEngine();
