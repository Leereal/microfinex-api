import { prisma } from '../config/database';
import { storageService } from './storage.service';

/**
 * The loan statement, as one self-contained HTML document.
 *
 * This lives on the server so that the printed page and the downloaded PDF are
 * the same document rather than two templates that drift apart. The browser's
 * Print button fetches this; the PDF endpoint renders exactly this through
 * headless Chromium. "Exactly as print preview" is then true by construction
 * rather than by two teams keeping two templates in step.
 */

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDate = (value: Date | string | null | undefined): string => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

/** Money in the loan's own currency. Never a hardcoded dollar sign. */
const money = (amount: unknown, currency: string): string => {
  const value = Number(amount ?? 0);
  try {
    return value.toLocaleString('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
};

export interface StatementLoan {
  id: string;
  organizationId: string;
}

/**
 * Fetch everything the statement shows, scoped to one organization.
 */
export async function getStatementData(loanId: string, organizationId: string) {
  const loan = await prisma.loan.findFirst({
    where: { id: loanId, organizationId },
    include: {
      client: true,
      product: true,
      branch: true,
      organization: true,
      loanCharges: true,
      repaymentSchedule: { orderBy: { installmentNumber: 'asc' } },
      payments: {
        orderBy: { paymentDate: 'asc' },
        include: { receiver: { select: { firstName: true, lastName: true } } },
      },
      createdBy: { select: { firstName: true, lastName: true } },
      disbursedBy: { select: { firstName: true, lastName: true } },
    },
  });

  if (!loan) return null;

  /**
   * The organization's logo, as a data URI.
   *
   * A signed bucket URL would work in a browser but not in the PDF renderer,
   * which loads the document with no network access - the image would simply be
   * missing from the file. Embedding the bytes makes the statement
   * self-contained, which is what a document that gets emailed and archived
   * should be anyway.
   */
  let logoDataUri: string | null = null;
  if (loan.organization?.logo) {
    try {
      const bytes = await storageService.download(loan.organization.logo);
      const extension = loan.organization.logo.split('.').pop()?.toLowerCase();
      const mime =
        extension === 'png'
          ? 'image/png'
          : extension === 'svg'
            ? 'image/svg+xml'
            : extension === 'webp'
              ? 'image/webp'
              : 'image/jpeg';
      logoDataUri = `data:${mime};base64,${bytes.toString('base64')}`;
    } catch (error) {
      // A statement without a logo is still a statement.
      console.error('Could not embed the organization logo:', error);
    }
  }

  return { ...loan, logoDataUri };
}

export function renderStatementHtml(loan: any): string {
  const currency = loan.currency || loan.product?.currency || 'USD';
  const org = loan.organization;

  const clientName =
    [loan.client?.firstName, loan.client?.lastName].filter(Boolean).join(' ') ||
    loan.client?.businessName ||
    'N/A';

  const principal = Number(loan.amount ?? 0);
  const totalInterest = Number(loan.totalInterest ?? 0);
  const outstanding = Number(loan.outstandingBalance ?? 0);

  /**
   * Money out and money in are not the same column.
   *
   * A disbursement and a top-up are payments in the same table as repayments,
   * and the statement used to add all of them into "total payments received" -
   * so a loan that had been topped up twice read as though the client had paid
   * three instalments, and the balance made no sense against it. What the
   * lender advanced belongs in its own section; only what the client handed
   * over counts as paid.
   */
  const isAdvance = (p: any) =>
    p.type === 'LOAN_DISBURSEMENT' || p.type === 'LOAN_TOPUP';

  /**
   * A reversed payment is not money the client has handed over.
   *
   * It stays on the statement - the client saw it taken and is entitled to see
   * it undone - but it must not be counted, or the loan would read as partly
   * settled by a payment that was given back.
   */
  const isReversed = (p: any) =>
    p.status === 'REVERSED' || p.status === 'CANCELLED' || p.status === 'FAILED';

  const advancePayments = (loan.payments ?? []).filter(isAdvance);
  const repayments = (loan.payments ?? []).filter(
    (p: any) => !isAdvance(p) && !isReversed(p)
  );
  const reversedPayments = (loan.payments ?? []).filter(
    (p: any) => !isAdvance(p) && isReversed(p)
  );

  const totalPaid = repayments.reduce(
    (sum: number, p: any) => sum + Number(p.amount ?? 0),
    0
  );

  /**
   * Each advance, with what it added to the loan beside what actually left the
   * till. A top-up records the principal advanced in principalAmount and the
   * cash in amount, so the charges taken off it are simply the difference. The
   * original disbursement is whatever is left of the principal once the top-ups
   * are accounted for, which keeps the column adding up to the loan's principal
   * however it was paid out.
   */
  const topUps = advancePayments.filter((p: any) => p.type === 'LOAN_TOPUP');
  const toppedUpPrincipal = topUps.reduce(
    (sum: number, p: any) => sum + Number(p.principalAmount ?? p.amount ?? 0),
    0
  );
  const originalPrincipal = Math.max(principal - toppedUpPrincipal, 0);

  const advances = advancePayments.map((payment: any) => ({
    payment,
    isTopUp: payment.type === 'LOAN_TOPUP',
    advanced:
      payment.type === 'LOAN_TOPUP'
        ? Number(payment.principalAmount ?? payment.amount ?? 0)
        : originalPrincipal,
    deducted: 0,
    by:
      [payment.receiver?.firstName, payment.receiver?.lastName]
        .filter(Boolean)
        .join(' ') || '-',
  }));

  /**
   * Which advance each charge was raised against.
   *
   * A charge belongs to whichever advance it was applied closest to in time -
   * the fee on a top-up is raised as that top-up is paid out, minutes or days
   * away from any other. Matching on amount would not do: two top-ups of the
   * same size carry identical fees.
   */
  for (const charge of loan.loanCharges ?? []) {
    if (!advances.length) break;

    const appliedAt = new Date(charge.appliedAt ?? 0).getTime();
    let closest = advances[0];
    let smallest = Infinity;

    for (const advance of advances) {
      const distance = Math.abs(
        new Date(advance.payment.paymentDate ?? 0).getTime() - appliedAt
      );
      if (distance < smallest) {
        smallest = distance;
        closest = advance;
      }
    }

    closest.deducted += Number(charge.calculatedAmount ?? 0);
  }

  const advanceRows = advances
    .map(
      (advance: any) => `
        <tr>
          <td>${formatDate(advance.payment.paymentDate)}</td>
          <td>${
            advance.isTopUp
              ? '<span class="tag tag-topup">Top-up</span>'
              : '<span class="tag">Disbursement</span>'
          }</td>
          <td>${escapeHtml(
            advance.payment.transactionRef ||
              advance.payment.paymentNumber ||
              '-'
          )}</td>
          <td class="text-right">${money(advance.advanced, currency)}</td>
          <td class="text-right">${
            advance.deducted > 0 ? money(advance.deducted, currency) : '-'
          }</td>
          <td>${escapeHtml(advance.by)}</td>
        </tr>`
    )
    .join('');

  const totalAdvanced = advances.reduce(
    (sum: number, a: any) => sum + a.advanced,
    0
  );
  const totalDeducted = advances.reduce(
    (sum: number, a: any) => sum + a.deducted,
    0
  );

  const charges = loan.loanCharges ?? [];
  const chargeRows = charges
    .map(
      (charge: any) => `
        <tr>
          <td style="padding-left:18px">${escapeHtml(charge.chargeName)}
            <span class="charge-basis">on ${money(
              charge.baseAmount,
              currency
            )} advanced ${formatDate(charge.appliedAt)}</span>${
              charge.isDeductedFromPrincipal
                ? ' <span class="tag">Deducted from advance</span>'
                : ' <span class="tag tag-paid">Paid by client</span>'
            }</td>
          <!-- Settled as the money goes out, either way, so it is a credit:
               a charge is never carried as debt. -->
          <td class="text-right">-</td>
          <td class="text-right">${money(charge.calculatedAmount, currency)}</td>
          <td class="text-right">-</td>
        </tr>`
    )
    .join('');

  const scheduleRows = (loan.repaymentSchedule ?? [])
    .map(
      (row: any) => `
        <tr>
          <td class="text-center">${row.installmentNumber}</td>
          <td>${formatDate(row.dueDate)}</td>
          <td class="text-right">${money(row.principalAmount, currency)}</td>
          <td class="text-right">${money(row.interestAmount, currency)}</td>
          <td class="text-right">${money(row.totalAmount, currency)}</td>
          <td class="text-right">${money(row.paidAmount ?? 0, currency)}</td>
          <td class="text-center">${escapeHtml(row.status)}</td>
        </tr>`
    )
    .join('');

  const paymentRows = [...repayments, ...reversedPayments]
    .sort(
      (a: any, b: any) =>
        new Date(a.paymentDate ?? 0).getTime() -
        new Date(b.paymentDate ?? 0).getTime()
    )
    .map(
      (payment: any) => `
        <tr${isReversed(payment) ? ' class="reversed"' : ''}>
          <td>${formatDate(payment.paymentDate)}</td>
          <td>${escapeHtml(payment.reference ?? payment.paymentNumber ?? '-')}${
            isReversed(payment)
              ? ` <span class="tag tag-reversed">Reversed${
                  payment.reversalReason
                    ? `: ${escapeHtml(payment.reversalReason)}`
                    : ''
                }</span>`
              : ''
          }</td>
          <td>${escapeHtml(payment.method ?? payment.paymentMethod ?? '-')}</td>
          <td class="text-right">${money(payment.amount, currency)}</td>
        </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Loan Statement ${escapeHtml(loan.loanNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    padding: 20px;
    /* 210mm is exactly an A4 sheet, so a body that wide plus padding pushes
       content past the printable area. @page owns the margins in print. */
    max-width: 190mm;
    margin: 0 auto;
    color: #1a1a1a;
    font-size: 12px;
    line-height: 1.5;
  }
  .header { text-align: center; margin-bottom: 28px; border-bottom: 2px solid #0066cc; padding-bottom: 18px; }
  .header .logo { max-height: 64px; max-width: 200px; object-fit: contain; margin-bottom: 10px; }
  .header h1 { font-size: 22px; color: #0066cc; margin: 0 0 6px 0; letter-spacing: .5px; }
  .header h2 { font-size: 16px; color: #333; margin: 0; font-weight: normal; }
  .header p { color: #666; margin: 4px 0 0 0; font-size: 11px; }
  .section { margin-bottom: 22px; page-break-inside: avoid; }
  .section-title { font-size: 13px; font-weight: 600; color: #0066cc; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 30px; }
  .info-item { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dotted #eee; }
  .info-label { color: #666; }
  .info-value { font-weight: 600; text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; word-wrap: break-word; }
  th { background: #f3f4f6; padding: 8px; text-align: left; font-weight: 600; border-bottom: 2px solid #e5e7eb; }
  td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #fafafa; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .total-row td { font-weight: 700; background: #eef4ff !important; border-top: 2px solid #0066cc; }
  .tag { font-size: 9px; color: #047857; background: #ecfdf5; padding: 1px 5px; border-radius: 3px; white-space: nowrap; }
  .tag-topup { color: #b45309; background: #fffbeb; }
  .tag-paid { color: #1d4ed8; background: #eff6ff; }
  .tag-reversed { color: #b91c1c; background: #fef2f2; }
  tr.reversed td { color: #999; text-decoration: line-through; }
  tr.reversed td:first-child, tr.reversed td:nth-child(2) { text-decoration: none; }
  .charge-basis { color: #888; font-size: 10px; }
  .subtotal-row td { font-weight: 600; background: #f7f9fc !important; }
  .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 10px; }
  .empty { color: #888; font-style: italic; padding: 10px 0; }
  .note { color: #666; font-size: 10px; margin: 6px 0 0 0; font-style: italic; }

  @page { size: A4 portrait; margin: 12mm; }
  @media print {
    body { padding: 0; max-width: none; width: 100%; font-size: 11px; }
    .section { page-break-inside: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    thead { display: table-header-group; }
    .footer { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="header">
    ${
      loan.logoDataUri
        ? `<img class="logo" src="${loan.logoDataUri}" alt="${escapeHtml(org?.name ?? '')} logo" />`
        : ''
    }
    <h1>${escapeHtml(org?.name ?? 'MICROFINEX')}</h1>
    <h2>LOAN STATEMENT</h2>
    <p>Statement Date: ${formatDate(new Date())}</p>
    ${org?.address ? `<p>${escapeHtml(org.address)}</p>` : ''}
    ${
      org?.phone || org?.email
        ? `<p>${[org?.phone, org?.email].filter(Boolean).map(escapeHtml).join(' &middot; ')}</p>`
        : ''
    }
  </div>

  <div class="section">
    <div class="section-title">Loan Information</div>
    <div class="info-grid">
      <div class="info-item"><span class="info-label">Loan Number</span><span class="info-value">${escapeHtml(loan.loanNumber)}</span></div>
      <div class="info-item"><span class="info-label">Client Name</span><span class="info-value">${escapeHtml(clientName)}</span></div>
      <div class="info-item"><span class="info-label">Client Number</span><span class="info-value">${escapeHtml(loan.client?.clientNumber ?? 'N/A')}</span></div>
      <div class="info-item"><span class="info-label">Branch</span><span class="info-value">${escapeHtml(loan.branch?.name ?? 'N/A')}</span></div>
      <div class="info-item"><span class="info-label">Product</span><span class="info-value">${escapeHtml(loan.product?.name ?? 'N/A')}</span></div>
      <div class="info-item"><span class="info-label">Status</span><span class="info-value">${escapeHtml(loan.status)}</span></div>
      <div class="info-item"><span class="info-label">Disbursement Date</span><span class="info-value">${formatDate(loan.disbursedDate)}</span></div>
      <div class="info-item"><span class="info-label">Maturity Date</span><span class="info-value">${formatDate(loan.maturityDate)}</span></div>
      <div class="info-item"><span class="info-label">Interest Rate</span><span class="info-value">${Number(loan.interestRate ?? 0)}%</span></div>
      <div class="info-item"><span class="info-label">Currency</span><span class="info-value">${escapeHtml(currency)}</span></div>
      <div class="info-item"><span class="info-label">Created By</span><span class="info-value">${escapeHtml(
        [loan.createdBy?.firstName, loan.createdBy?.lastName].filter(Boolean).join(' ') || '-'
      )}</span></div>
      <div class="info-item"><span class="info-label">Disbursed By</span><span class="info-value">${escapeHtml(
        [loan.disbursedBy?.firstName, loan.disbursedBy?.lastName].filter(Boolean).join(' ') || '-'
      )}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Account Summary</div>
    <table>
      <thead>
        <tr><th style="width:46%">Description</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>Principal Advanced${
            topUps.length > 0
              ? ` <span class="charge-basis">original ${money(
                  originalPrincipal,
                  currency
                )} + ${topUps.length} top-up${topUps.length === 1 ? '' : 's'}</span>`
              : ''
          }</td>
          <td class="text-right">${money(principal, currency)}</td>
          <td class="text-right">-</td>
          <td class="text-right">${money(principal, currency)}</td>
        </tr>
        <tr>
          <td>Interest Charged</td>
          <td class="text-right">${money(totalInterest, currency)}</td>
          <td class="text-right">-</td>
          <td class="text-right">${money(principal + totalInterest, currency)}</td>
        </tr>
        ${chargeRows}
        <tr>
          <td>Repayments Received${
            repayments.length > 0
              ? ` <span class="charge-basis">${repayments.length} payment${
                  repayments.length === 1 ? '' : 's'
                }</span>`
              : ''
          }</td>
          <td class="text-right">-</td>
          <td class="text-right">${money(totalPaid, currency)}</td>
          <td class="text-right">${money(principal + totalInterest - totalPaid, currency)}</td>
        </tr>
        <tr class="total-row">
          <td>Outstanding Balance</td>
          <td class="text-right">-</td>
          <td class="text-right">-</td>
          <td class="text-right">${money(outstanding, currency)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Money Advanced</div>
    ${
      advanceRows
        ? `<table>
      <thead>
        <tr>
          <th style="width:15%">Date</th>
          <th style="width:14%">Type</th>
          <th>Reference</th>
          <th class="text-right">Advanced</th>
          <th class="text-right">Charges</th>
          <th style="width:15%">By</th>
        </tr>
      </thead>
      <tbody>
        ${advanceRows}
        <tr class="subtotal-row">
          <td colspan="3">Total advanced on this loan</td>
          <td class="text-right">${money(totalAdvanced, currency)}</td>
          <td class="text-right">${money(totalDeducted, currency)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
    ${
      topUps.length > 0
        ? `<p class="note">This loan was topped up ${topUps.length} time${
            topUps.length === 1 ? '' : 's'
          } after it was first paid out. A top-up adds to the same loan rather than opening a new one, so the schedule below covers the whole balance.</p>`
        : ''
    }`
        : '<p class="empty">Nothing has been paid out on this loan yet.</p>'
    }
  </div>

  <div class="section">
    <div class="section-title">Repayment Schedule</div>
    ${
      scheduleRows
        ? `<table>
      <thead>
        <tr>
          <th class="text-center" style="width:7%">#</th>
          <th style="width:20%">Due Date</th>
          <th class="text-right">Principal</th>
          <th class="text-right">Interest</th>
          <th class="text-right">Total</th>
          <th class="text-right">Paid</th>
          <th class="text-center" style="width:14%">Status</th>
        </tr>
      </thead>
      <tbody>${scheduleRows}</tbody>
    </table>`
        : '<p class="empty">No repayment schedule has been generated yet.</p>'
    }
  </div>

  <div class="section">
    <div class="section-title">Repayments Received</div>
    ${
      paymentRows
        ? `<table>
      <thead>
        <tr><th style="width:20%">Date</th><th>Reference</th><th style="width:22%">Method</th><th class="text-right" style="width:22%">Amount</th></tr>
      </thead>
      <tbody>${paymentRows}</tbody>
    </table>`
        : '<p class="empty">No repayments have been received yet.</p>'
    }
  </div>

  <div class="footer">
    <p>This statement was generated on ${formatDate(new Date())} by ${escapeHtml(org?.name ?? 'Microfinex')}.</p>
    <p>For any queries, please contact your loan officer or visit your nearest branch.</p>
  </div>
</body>
</html>`;
}

export default { getStatementData, renderStatementHtml };
