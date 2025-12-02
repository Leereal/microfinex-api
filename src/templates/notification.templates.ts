/**
 * Notification Templates
 * Pre-defined message templates for various notifications
 */

export interface TemplateData {
  [key: string]: string | number | Date | undefined;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  type: 'SMS' | 'EMAIL' | 'BOTH';
  subject?: string; // For email
  smsTemplate: string;
  emailTemplate: string;
  variables: string[];
}

/**
 * Replace template variables with actual values
 */
export function compileTemplate(template: string, data: TemplateData): string {
  let result = template;
  
  for (const [key, value] of Object.entries(data)) {
    const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    let displayValue = '';
    
    if (value instanceof Date) {
      displayValue = value.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } else if (typeof value === 'number') {
      displayValue = value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } else {
      displayValue = String(value || '');
    }
    
    result = result.replace(placeholder, displayValue);
  }
  
  return result;
}

// ===== NOTIFICATION TEMPLATES =====

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  // OTP Verification
  OTP_VERIFICATION: {
    id: 'otp_verification',
    name: 'OTP Verification',
    type: 'SMS',
    smsTemplate: 'Your Microfinex verification code is: {{ code }}. Valid for {{ minutes }} minutes. Do not share this code.',
    emailTemplate: `
      <h2>Verification Code</h2>
      <p>Your verification code is: <strong>{{ code }}</strong></p>
      <p>This code is valid for {{ minutes }} minutes.</p>
      <p>If you did not request this code, please ignore this message.</p>
    `,
    variables: ['code', 'minutes'],
  },

  // Loan Disbursement Success
  LOAN_DISBURSED: {
    id: 'loan_disbursed',
    name: 'Loan Disbursement Notification',
    type: 'BOTH',
    subject: 'Your Loan Has Been Disbursed - {{ loanNumber }}',
    smsTemplate: 'Dear {{ clientName }}, your loan of {{ currency }} {{ amount }} ({{ loanNumber }}) has been disbursed. First payment due: {{ firstDueDate }}. Thank you for choosing Microfinex.',
    emailTemplate: `
      <h2>Loan Disbursement Confirmation</h2>
      <p>Dear {{ clientName }},</p>
      <p>We are pleased to inform you that your loan has been successfully disbursed.</p>
      <table>
        <tr><td>Loan Number:</td><td><strong>{{ loanNumber }}</strong></td></tr>
        <tr><td>Amount:</td><td><strong>{{ currency }} {{ amount }}</strong></td></tr>
        <tr><td>Term:</td><td>{{ term }} months</td></tr>
        <tr><td>Monthly Payment:</td><td>{{ currency }} {{ monthlyPayment }}</td></tr>
        <tr><td>First Payment Due:</td><td>{{ firstDueDate }}</td></tr>
        <tr><td>Disbursement Method:</td><td>{{ disbursementMethod }}</td></tr>
      </table>
      <p>Please ensure timely payments to maintain a good credit record.</p>
      <p>Thank you for choosing Microfinex.</p>
    `,
    variables: ['clientName', 'loanNumber', 'currency', 'amount', 'term', 'monthlyPayment', 'firstDueDate', 'disbursementMethod'],
  },

  // Payment Reminder (3 days before)
  PAYMENT_REMINDER: {
    id: 'payment_reminder',
    name: 'Payment Reminder',
    type: 'BOTH',
    subject: 'Payment Reminder - {{ loanNumber }}',
    smsTemplate: 'Reminder: Your loan payment of {{ currency }} {{ amount }} for {{ loanNumber }} is due on {{ dueDate }}. Pay early to avoid penalties. Microfinex.',
    emailTemplate: `
      <h2>Payment Reminder</h2>
      <p>Dear {{ clientName }},</p>
      <p>This is a friendly reminder that your upcoming loan payment is due soon.</p>
      <table>
        <tr><td>Loan Number:</td><td><strong>{{ loanNumber }}</strong></td></tr>
        <tr><td>Amount Due:</td><td><strong>{{ currency }} {{ amount }}</strong></td></tr>
        <tr><td>Due Date:</td><td><strong>{{ dueDate }}</strong></td></tr>
        <tr><td>Outstanding Balance:</td><td>{{ currency }} {{ outstandingBalance }}</td></tr>
      </table>
      <p>Please ensure payment is made on or before the due date to avoid late payment penalties.</p>
      <p>If you have already made this payment, please disregard this reminder.</p>
      <p>Thank you,<br>Microfinex Team</p>
    `,
    variables: ['clientName', 'loanNumber', 'currency', 'amount', 'dueDate', 'outstandingBalance'],
  },

  // Overdue Notice
  OVERDUE_NOTICE: {
    id: 'overdue_notice',
    name: 'Overdue Payment Notice',
    type: 'BOTH',
    subject: 'URGENT: Overdue Payment - {{ loanNumber }}',
    smsTemplate: 'URGENT: Your loan {{ loanNumber }} is {{ daysOverdue }} days overdue. Amount due: {{ currency }} {{ overdueAmount }}. Please pay immediately to avoid further penalties. Microfinex.',
    emailTemplate: `
      <h2 style="color: #c00;">Overdue Payment Notice</h2>
      <p>Dear {{ clientName }},</p>
      <p><strong>Your loan payment is overdue and requires immediate attention.</strong></p>
      <table>
        <tr><td>Loan Number:</td><td><strong>{{ loanNumber }}</strong></td></tr>
        <tr><td>Days Overdue:</td><td style="color: #c00;"><strong>{{ daysOverdue }} days</strong></td></tr>
        <tr><td>Overdue Amount:</td><td style="color: #c00;"><strong>{{ currency }} {{ overdueAmount }}</strong></td></tr>
        <tr><td>Penalty Accrued:</td><td>{{ currency }} {{ penaltyAmount }}</td></tr>
        <tr><td>Total Due Now:</td><td style="color: #c00;"><strong>{{ currency }} {{ totalDue }}</strong></td></tr>
      </table>
      <p>Please make payment immediately to avoid:</p>
      <ul>
        <li>Additional penalty charges</li>
        <li>Negative impact on your credit rating</li>
        <li>Possible legal action</li>
      </ul>
      <p>If you are experiencing difficulties, please contact us immediately to discuss payment arrangements.</p>
      <p>Microfinex Collections Team</p>
    `,
    variables: ['clientName', 'loanNumber', 'daysOverdue', 'currency', 'overdueAmount', 'penaltyAmount', 'totalDue'],
  },

  // Payment Received Confirmation
  PAYMENT_RECEIVED: {
    id: 'payment_received',
    name: 'Payment Received',
    type: 'BOTH',
    subject: 'Payment Received - {{ loanNumber }}',
    smsTemplate: 'Payment of {{ currency }} {{ amount }} received for loan {{ loanNumber }}. New balance: {{ currency }} {{ newBalance }}. Receipt: {{ receiptNumber }}. Thank you! Microfinex.',
    emailTemplate: `
      <h2>Payment Confirmation</h2>
      <p>Dear {{ clientName }},</p>
      <p>We have received your payment. Thank you!</p>
      <table>
        <tr><td>Receipt Number:</td><td><strong>{{ receiptNumber }}</strong></td></tr>
        <tr><td>Loan Number:</td><td>{{ loanNumber }}</td></tr>
        <tr><td>Amount Paid:</td><td><strong>{{ currency }} {{ amount }}</strong></td></tr>
        <tr><td>Payment Date:</td><td>{{ paymentDate }}</td></tr>
        <tr><td>Payment Method:</td><td>{{ paymentMethod }}</td></tr>
        <tr><td>New Outstanding Balance:</td><td>{{ currency }} {{ newBalance }}</td></tr>
      </table>
      <p>Thank you for your payment.</p>
      <p>Microfinex Team</p>
    `,
    variables: ['clientName', 'loanNumber', 'currency', 'amount', 'newBalance', 'receiptNumber', 'paymentDate', 'paymentMethod'],
  },

  // Application Status Update
  APPLICATION_STATUS: {
    id: 'application_status',
    name: 'Application Status Update',
    type: 'BOTH',
    subject: 'Loan Application Update - {{ applicationId }}',
    smsTemplate: 'Your loan application {{ applicationId }} status: {{ status }}. {{ message }} Microfinex.',
    emailTemplate: `
      <h2>Loan Application Update</h2>
      <p>Dear {{ clientName }},</p>
      <p>Your loan application status has been updated.</p>
      <table>
        <tr><td>Application ID:</td><td><strong>{{ applicationId }}</strong></td></tr>
        <tr><td>Status:</td><td><strong>{{ status }}</strong></td></tr>
        <tr><td>Requested Amount:</td><td>{{ currency }} {{ amount }}</td></tr>
      </table>
      <p>{{ message }}</p>
      <p>If you have any questions, please contact us.</p>
      <p>Microfinex Team</p>
    `,
    variables: ['clientName', 'applicationId', 'status', 'currency', 'amount', 'message'],
  },

  // Loan Approval
  LOAN_APPROVED: {
    id: 'loan_approved',
    name: 'Loan Approved',
    type: 'BOTH',
    subject: 'Congratulations! Your Loan is Approved',
    smsTemplate: 'Great news! Your loan application for {{ currency }} {{ amount }} has been APPROVED. Visit our office to complete disbursement. Microfinex.',
    emailTemplate: `
      <h2 style="color: #0a0;">Loan Approved!</h2>
      <p>Dear {{ clientName }},</p>
      <p>Congratulations! Your loan application has been approved.</p>
      <table>
        <tr><td>Approved Amount:</td><td><strong>{{ currency }} {{ amount }}</strong></td></tr>
        <tr><td>Interest Rate:</td><td>{{ interestRate }}% per annum</td></tr>
        <tr><td>Loan Term:</td><td>{{ term }} months</td></tr>
        <tr><td>Monthly Payment:</td><td>{{ currency }} {{ monthlyPayment }}</td></tr>
      </table>
      <p><strong>Next Steps:</strong></p>
      <ol>
        <li>Visit our nearest branch with your ID</li>
        <li>Sign the loan agreement</li>
        <li>Receive your funds</li>
      </ol>
      <p>Thank you for choosing Microfinex!</p>
    `,
    variables: ['clientName', 'currency', 'amount', 'interestRate', 'term', 'monthlyPayment'],
  },

  // Loan Rejected
  LOAN_REJECTED: {
    id: 'loan_rejected',
    name: 'Loan Rejected',
    type: 'BOTH',
    subject: 'Loan Application Update',
    smsTemplate: 'We regret to inform you that your loan application could not be approved at this time. Please contact us for more information. Microfinex.',
    emailTemplate: `
      <h2>Loan Application Decision</h2>
      <p>Dear {{ clientName }},</p>
      <p>Thank you for your loan application. After careful review, we regret to inform you that we are unable to approve your application at this time.</p>
      <p><strong>Reason:</strong> {{ reason }}</p>
      <p>This decision does not necessarily reflect negatively on you. There are many factors that go into our lending decisions.</p>
      <p>You may:</p>
      <ul>
        <li>Reapply after {{ waitPeriod }} days</li>
        <li>Contact us to discuss alternative options</li>
        <li>Provide additional documentation that may support your application</li>
      </ul>
      <p>Thank you for considering Microfinex.</p>
    `,
    variables: ['clientName', 'reason', 'waitPeriod'],
  },

  // Welcome New Client
  WELCOME_CLIENT: {
    id: 'welcome_client',
    name: 'Welcome New Client',
    type: 'BOTH',
    subject: 'Welcome to Microfinex!',
    smsTemplate: 'Welcome to Microfinex, {{ clientName }}! Your client ID is {{ clientId }}. We look forward to serving you. Questions? Call us anytime.',
    emailTemplate: `
      <h2>Welcome to Microfinex!</h2>
      <p>Dear {{ clientName }},</p>
      <p>Welcome to Microfinex! We are delighted to have you as a valued client.</p>
      <table>
        <tr><td>Client ID:</td><td><strong>{{ clientId }}</strong></td></tr>
        <tr><td>Registration Date:</td><td>{{ registrationDate }}</td></tr>
      </table>
      <p>With Microfinex, you can access:</p>
      <ul>
        <li>Personal and business loans</li>
        <li>Flexible repayment options</li>
        <li>Quick loan processing</li>
        <li>Competitive interest rates</li>
      </ul>
      <p>If you have any questions, please don't hesitate to contact us.</p>
      <p>Welcome aboard!</p>
      <p>The Microfinex Team</p>
    `,
    variables: ['clientName', 'clientId', 'registrationDate'],
  },

  // Loan Completion
  LOAN_COMPLETED: {
    id: 'loan_completed',
    name: 'Loan Fully Paid',
    type: 'BOTH',
    subject: 'Congratulations! Loan Fully Paid - {{ loanNumber }}',
    smsTemplate: 'Congratulations {{ clientName }}! Your loan {{ loanNumber }} is now fully paid. Thank you for your timely payments. Apply for a new loan anytime! Microfinex.',
    emailTemplate: `
      <h2 style="color: #0a0;">Loan Fully Paid!</h2>
      <p>Dear {{ clientName }},</p>
      <p>Congratulations! We are pleased to confirm that your loan has been fully paid.</p>
      <table>
        <tr><td>Loan Number:</td><td><strong>{{ loanNumber }}</strong></td></tr>
        <tr><td>Original Amount:</td><td>{{ currency }} {{ originalAmount }}</td></tr>
        <tr><td>Total Paid:</td><td>{{ currency }} {{ totalPaid }}</td></tr>
        <tr><td>Completion Date:</td><td>{{ completionDate }}</td></tr>
      </table>
      <p>Thank you for your commitment to timely payments. Your excellent repayment record qualifies you for:</p>
      <ul>
        <li>Higher loan amounts</li>
        <li>Better interest rates</li>
        <li>Faster processing</li>
      </ul>
      <p>Ready for your next loan? Apply anytime!</p>
      <p>Thank you for choosing Microfinex.</p>
    `,
    variables: ['clientName', 'loanNumber', 'currency', 'originalAmount', 'totalPaid', 'completionDate'],
  },
};

/**
 * Get template by ID
 */
export function getTemplate(templateId: string): NotificationTemplate | undefined {
  return NOTIFICATION_TEMPLATES[templateId];
}

/**
 * Compile SMS message from template
 */
export function compileSMSTemplate(templateId: string, data: TemplateData): string | null {
  const template = getTemplate(templateId);
  if (!template) return null;
  return compileTemplate(template.smsTemplate, data);
}

/**
 * Compile email content from template
 */
export function compileEmailTemplate(templateId: string, data: TemplateData): { subject: string; body: string } | null {
  const template = getTemplate(templateId);
  if (!template) return null;
  
  return {
    subject: template.subject ? compileTemplate(template.subject, data) : template.name,
    body: compileTemplate(template.emailTemplate, data),
  };
}
