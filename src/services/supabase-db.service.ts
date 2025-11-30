import { supabaseAdmin } from '../config/supabase-enhanced';
import { UserRole } from '../types';

/**
 * Supabase Database Service
 *
 * This service provides high-level database operations that leverage
 * Supabase's native features like Row Level Security, real-time subscriptions,
 * and automatic audit logging.
 */
export class SupabaseDbService {
  /**
   * Get user with organization context
   */
  static async getUserWithOrganization(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select(
        `
        *,
        organization:organizations(*)
      `
      )
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get organization-scoped loans
   */
  static async getLoans(organizationId: string, filters: any = {}) {
    let query = supabaseAdmin
      .from('loans')
      .select(
        `
        *,
        client:clients(*),
        product:loan_products(*),
        loan_officer:users!loan_officer_id(id, first_name, last_name),
        payments(*)
      `
      )
      .eq('organization_id', organizationId);

    // Apply filters
    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.clientId) {
      query = query.eq('client_id', filters.clientId);
    }

    if (filters.search) {
      query = query.or(
        `loan_number.ilike.%${filters.search}%,client.first_name.ilike.%${filters.search}%,client.last_name.ilike.%${filters.search}%`
      );
    }

    // Pagination
    if (filters.page && filters.limit) {
      const start = (filters.page - 1) * filters.limit;
      const end = start + filters.limit - 1;
      query = query.range(start, end);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return { data, count };
  }

  /**
   * Create loan with calculation
   */
  static async createLoan(loanData: any, calculationResult: any) {
    const { data: loan, error: loanError } = await supabaseAdmin
      .from('loans')
      .insert({
        ...loanData,
        total_amount: calculationResult.totalAmount,
        total_interest: calculationResult.totalInterest,
        installment_amount: calculationResult.monthlyInstallment,
      })
      .select()
      .single();

    if (loanError) throw loanError;

    // Create repayment schedule
    const scheduleData = calculationResult.repaymentSchedule.map(
      (installment: any) => ({
        loan_id: loan.id,
        installment_number: installment.installmentNumber,
        due_date: installment.dueDate,
        principal_amount: installment.principalAmount,
        interest_amount: installment.interestAmount,
        total_amount: installment.totalAmount,
        outstanding_amount: installment.totalAmount,
      })
    );

    const { error: scheduleError } = await supabaseAdmin
      .from('repayment_schedule')
      .insert(scheduleData);

    if (scheduleError) throw scheduleError;

    return loan;
  }

  /**
   * Get clients with group information
   */
  static async getClients(organizationId: string, filters: any = {}) {
    let query = supabaseAdmin
      .from('clients')
      .select(
        `
        *,
        group_memberships:group_members(
          group:groups(*)
        )
      `
      )
      .eq('organization_id', organizationId);

    if (filters.search) {
      query = query.or(
        `first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`
      );
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) throw error;

    return data;
  }

  /**
   * Get loan products with charges
   */
  static async getLoanProducts(organizationId: string) {
    const { data, error } = await supabaseAdmin
      .from('loan_products')
      .select(
        `
        *,
        product_charges(
          charge:charges(*)
        )
      `
      )
      .eq('organization_id', organizationId)
      .eq('is_active', true);

    if (error) throw error;
    return data;
  }

  /**
   * Record payment with automatic balance updates
   */
  static async recordPayment(paymentData: any) {
    // Start a transaction using Supabase's RPC function
    const { data, error } = await supabaseAdmin.rpc('process_loan_payment', {
      loan_id: paymentData.loanId,
      payment_amount: paymentData.amount,
      payment_method: paymentData.method,
      payment_date: paymentData.paymentDate,
      received_by: paymentData.receivedBy,
      notes: paymentData.notes,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Get dashboard metrics for organization
   */
  static async getDashboardMetrics(organizationId: string) {
    // This would typically use Supabase's RPC functions for complex aggregations
    const { data, error } = await supabaseAdmin.rpc('get_dashboard_metrics', {
      org_id: organizationId,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Setup real-time subscription for loan updates
   */
  static setupLoanSubscription(
    organizationId: string,
    callback: (payload: any) => void
  ) {
    return supabaseAdmin
      .channel('loan-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loans',
          filter: `organization_id=eq.${organizationId}`,
        },
        callback
      )
      .subscribe();
  }

  /**
   * Enable Row Level Security policies
   */
  static async setupRLS() {
    // These would be run as database migrations
    const policies = [
      // Users can only see their organization's data
      `
        CREATE POLICY "organization_isolation_loans" ON loans
        USING (organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        ));
      `,

      // Clients policy
      `
        CREATE POLICY "organization_isolation_clients" ON clients
        USING (organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        ));
      `,

      // Payments policy
      `
        CREATE POLICY "organization_isolation_payments" ON payments
        USING (loan_id IN (
          SELECT id FROM loans WHERE organization_id IN (
            SELECT organization_id FROM users WHERE id = auth.uid()
          )
        ));
      `,
    ];

    // These would be executed as database functions/migrations
    console.log('RLS Policies to be applied:', policies);
  }

  /**
   * Audit log function
   */
  static async logActivity(
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    changes?: any
  ) {
    const { error } = await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      changes,
      timestamp: new Date().toISOString(),
    });

    if (error) {
      console.error('Failed to log activity:', error);
    }
  }
}

export default SupabaseDbService;
