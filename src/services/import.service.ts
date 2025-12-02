/**
 * Import Service
 * Handles bulk data import from Excel/CSV files
 */

// Use require for xlsx to avoid module resolution issues
const XLSX = require('xlsx');
import { z } from 'zod';
import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';

// Import types
export type ImportType = 'CLIENTS' | 'LOANS' | 'PAYMENTS' | 'EMPLOYERS' | 'BRANCHES';
export type ImportStatus = 'PENDING' | 'VALIDATING' | 'IMPORTING' | 'COMPLETED' | 'FAILED';

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  failed: number;
  errors: ImportError[];
  warnings: string[];
  duration: number;
}

export interface ImportError {
  row: number;
  field?: string;
  value?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  rowCount: number;
  errors: ImportError[];
  warnings: string[];
  preview: Record<string, any>[];
}

// Validation schemas for different import types
const clientImportSchema = z.object({
  firstName: z.string().min(1, 'First name required'),
  lastName: z.string().min(1, 'Last name required'),
  idNumber: z.string().optional(),
  phoneNumber: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dateOfBirth: z.string().optional().transform((v) => v ? new Date(v) : undefined),
  address: z.string().optional(),
  city: z.string().optional(),
  employerId: z.string().optional(),
  employeeNumber: z.string().optional(),
  branchId: z.string().optional(),
});

const paymentImportSchema = z.object({
  loanNumber: z.string().min(1, 'Loan number required'),
  amount: z.number().positive('Amount must be positive'),
  paymentDate: z.string().transform((v) => new Date(v)),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHECK', 'OTHER']).default('CASH'),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

const employerImportSchema = z.object({
  name: z.string().min(1, 'Name required'),
  registrationNumber: z.string().optional(),
  contactPerson: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  payrollDay: z.number().min(1).max(31).optional(),
  isActive: z.boolean().default(true),
});

const branchImportSchema = z.object({
  name: z.string().min(1, 'Name required'),
  code: z.string().min(1, 'Code required'),
  address: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  managerId: z.string().optional(),
  isActive: z.boolean().default(true),
});

class ImportService {
  /**
   * Parse Excel/CSV file and return data
   */
  parseFile(buffer: Buffer, filename: string): Record<string, any>[] {
    const ext = filename.toLowerCase().split('.').pop();
    
    let workbook: any;
    if (ext === 'csv') {
      workbook = XLSX.read(buffer.toString(), { type: 'string' });
    } else {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    const data = XLSX.utils.sheet_to_json(sheet, {
      raw: false,
      defval: '',
    });

    return data as Record<string, any>[];
  }

  /**
   * Normalize column headers
   */
  private normalizeHeaders(data: Record<string, any>[]): Record<string, any>[] {
    return data.map((row) => {
      const normalized: Record<string, any> = {};
      for (const [key, value] of Object.entries(row)) {
        // Convert to camelCase and remove special chars
        const normalizedKey = key
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
          .replace(/^\s+/, '');
        normalized[normalizedKey] = value;
      }
      return normalized;
    });
  }

  /**
   * Validate data before import
   */
  async validateData(
    type: ImportType,
    data: Record<string, any>[],
    organizationId: string
  ): Promise<ValidationResult> {
    const errors: ImportError[] = [];
    const warnings: string[] = [];
    const normalizedData = this.normalizeHeaders(data);

    const schema = this.getSchema(type);

    for (let i = 0; i < normalizedData.length; i++) {
      const row = normalizedData[i];
      if (!row) continue; // Skip if row is undefined
      const rowNum = i + 2; // Excel row (1-indexed + header)

      try {
        // Parse numeric fields
        if (type === 'PAYMENTS' && row.amount) {
          row.amount = parseFloat(String(row.amount).replace(/[^0-9.-]/g, ''));
        }
        if (type === 'EMPLOYERS' && row.payrollDay) {
          row.payrollDay = parseInt(String(row.payrollDay));
        }

        // Validate row
        const result = schema.safeParse(row);
        if (!result.success) {
          for (const issue of result.error.issues) {
            const fieldPath = issue.path[0];
            errors.push({
              row: rowNum,
              field: issue.path.join('.'),
              value: fieldPath !== undefined ? String(row[fieldPath] || '') : '',
              message: issue.message,
            });
          }
        }

        // Type-specific validation
        if (type === 'CLIENTS' && row.idNumber) {
          // Check for duplicate ID number
          const existing = await prisma.client.findFirst({
            where: {
              idNumber: row.idNumber,
              organizationId,
            },
          });
          if (existing) {
            warnings.push(`Row ${rowNum}: Client with ID ${row.idNumber} already exists`);
          }
        }

        if (type === 'PAYMENTS' && row.loanNumber) {
          // Check if loan exists
          const loan = await prisma.loan.findFirst({
            where: {
              loanNumber: row.loanNumber,
              organizationId,
            },
          });
          if (!loan) {
            errors.push({
              row: rowNum,
              field: 'loanNumber',
              value: row.loanNumber,
              message: `Loan ${row.loanNumber} not found`,
            });
          }
        }
      } catch (err: any) {
        errors.push({
          row: rowNum,
          message: `Validation error: ${err.message}`,
        });
      }
    }

    return {
      valid: errors.length === 0,
      rowCount: normalizedData.length,
      errors,
      warnings,
      preview: normalizedData.slice(0, 5),
    };
  }

  /**
   * Import data
   */
  async importData(
    type: ImportType,
    data: Record<string, any>[],
    organizationId: string,
    userId: string,
    options: {
      skipDuplicates?: boolean;
      updateExisting?: boolean;
    } = {}
  ): Promise<ImportResult> {
    const startTime = Date.now();
    const normalizedData = this.normalizeHeaders(data);
    
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: ImportError[] = [];
    const warnings: string[] = [];

    const schema = this.getSchema(type);

    for (let i = 0; i < normalizedData.length; i++) {
      const row = normalizedData[i];
      if (!row) continue; // Skip if row is undefined
      const rowNum = i + 2;

      try {
        // Parse and validate
        if (type === 'PAYMENTS' && row.amount) {
          row.amount = parseFloat(String(row.amount).replace(/[^0-9.-]/g, ''));
        }
        if (type === 'EMPLOYERS' && row.payrollDay) {
          row.payrollDay = parseInt(String(row.payrollDay));
        }

        const parseResult = schema.safeParse(row);
        if (!parseResult.success) {
          failed++;
          for (const issue of parseResult.error.issues) {
            const fieldPath = issue.path[0];
            errors.push({
              row: rowNum,
              field: issue.path.join('.'),
              value: fieldPath !== undefined ? String(row[fieldPath] || '') : '',
              message: issue.message,
            });
          }
          continue;
        }

        const validData = parseResult.data;

        // Import based on type
        switch (type) {
          case 'CLIENTS':
            const clientResult = await this.importClient(
              validData,
              organizationId,
              userId,
              options
            );
            if (clientResult === 'imported') imported++;
            else if (clientResult === 'skipped') skipped++;
            else if (clientResult === 'failed') failed++;
            break;

          case 'PAYMENTS':
            const paymentResult = await this.importPayment(
              validData,
              organizationId,
              userId
            );
            if (paymentResult.success) imported++;
            else {
              failed++;
              if (paymentResult.error) {
                errors.push({ row: rowNum, message: paymentResult.error });
              }
            }
            break;

          case 'EMPLOYERS':
            const employerResult = await this.importEmployer(
              validData,
              organizationId,
              userId,
              options
            );
            if (employerResult === 'imported') imported++;
            else if (employerResult === 'skipped') skipped++;
            else if (employerResult === 'failed') failed++;
            break;

          case 'BRANCHES':
            const branchResult = await this.importBranch(
              validData,
              organizationId,
              userId,
              options
            );
            if (branchResult === 'imported') imported++;
            else if (branchResult === 'skipped') skipped++;
            else if (branchResult === 'failed') failed++;
            break;

          default:
            failed++;
            errors.push({ row: rowNum, message: `Unsupported import type: ${type}` });
        }
      } catch (err: any) {
        failed++;
        errors.push({ row: rowNum, message: err.message });
      }
    }

    const duration = Date.now() - startTime;

    return {
      success: failed === 0,
      imported,
      skipped,
      failed,
      errors,
      warnings,
      duration,
    };
  }

  /**
   * Import a single client
   */
  private async importClient(
    data: any,
    organizationId: string,
    userId: string,
    options: { skipDuplicates?: boolean; updateExisting?: boolean }
  ): Promise<'imported' | 'skipped' | 'failed'> {
    // Check for existing
    if (data.idNumber) {
      const existing = await prisma.client.findFirst({
        where: {
          idNumber: data.idNumber,
          organizationId,
        },
      });

      if (existing) {
        if (options.updateExisting) {
          await prisma.client.update({
            where: { id: existing.id },
            data: {
              ...data,
              updatedAt: new Date(),
            },
          });
          return 'imported';
        } else if (options.skipDuplicates) {
          return 'skipped';
        }
        return 'failed';
      }
    }

    // Generate client number
    const clientNumber = await this.generateClientNumber(organizationId);

    await prisma.client.create({
      data: {
        ...data,
        clientNumber,
        organizationId,
        branchId: data.branchId || '', // Required field
        createdBy: userId,
        phone: data.phoneNumber || data.phone || `+${Date.now()}`, // Required unique field
      },
    });

    return 'imported';
  }

  /**
   * Import a single payment
   */
  private async importPayment(
    data: any,
    organizationId: string,
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Find loan
    const loan = await prisma.loan.findFirst({
      where: {
        loanNumber: data.loanNumber,
        organizationId,
      },
    });

    if (!loan) {
      return { success: false, error: `Loan ${data.loanNumber} not found` };
    }

    // Generate payment number
    const paymentNumber = await this.generateReceiptNumber(organizationId);

    // Create payment
    await prisma.payment.create({
      data: {
        loanId: loan.id,
        paymentNumber,
        amount: data.amount,
        paymentDate: data.paymentDate,
        method: data.paymentMethod || 'CASH',
        transactionRef: data.reference || paymentNumber,
        notes: data.notes,
        receivedBy: userId,
        status: 'COMPLETED',
      },
    });

    return { success: true };
  }

  /**
   * Import a single employer
   */
  private async importEmployer(
    data: any,
    organizationId: string,
    userId: string,
    options: { skipDuplicates?: boolean; updateExisting?: boolean }
  ): Promise<'imported' | 'skipped' | 'failed'> {
    // Check for existing by name
    const existing = await prisma.employer.findFirst({
      where: {
        name: data.name,
      },
    });

    if (existing) {
      if (options.updateExisting) {
        await prisma.employer.update({
          where: { id: existing.id },
          data: {
            ...data,
            updatedAt: new Date(),
          },
        });
        return 'imported';
      } else if (options.skipDuplicates) {
        return 'skipped';
      }
      return 'failed';
    }

    await prisma.employer.create({
      data: {
        name: data.name,
        address: data.address,
        phone: data.contactPhone,
        email: data.contactEmail,
        contactPerson: data.contactPerson,
        isActive: data.isActive ?? true,
      },
    });

    return 'imported';
  }

  /**
   * Import a single branch
   */
  private async importBranch(
    data: any,
    organizationId: string,
    userId: string,
    options: { skipDuplicates?: boolean; updateExisting?: boolean }
  ): Promise<'imported' | 'skipped' | 'failed'> {
    // Check for existing by code
    const existing = await prisma.branch.findFirst({
      where: {
        code: data.code,
        organizationId,
      },
    });

    if (existing) {
      if (options.updateExisting) {
        await prisma.branch.update({
          where: { id: existing.id },
          data: {
            ...data,
            updatedAt: new Date(),
          },
        });
        return 'imported';
      } else if (options.skipDuplicates) {
        return 'skipped';
      }
      return 'failed';
    }

    await prisma.branch.create({
      data: {
        name: data.name,
        code: data.code,
        address: data.address,
        phone: data.phone,
        email: data.email,
        organizationId,
        isActive: data.isActive ?? true,
      },
    });

    return 'imported';
  }

  /**
   * Get validation schema for import type
   */
  private getSchema(type: ImportType): z.ZodSchema<any> {
    switch (type) {
      case 'CLIENTS':
        return clientImportSchema;
      case 'PAYMENTS':
        return paymentImportSchema;
      case 'EMPLOYERS':
        return employerImportSchema;
      case 'BRANCHES':
        return branchImportSchema;
      default:
        throw new Error(`Unsupported import type: ${type}`);
    }
  }

  /**
   * Generate client number
   */
  private async generateClientNumber(organizationId: string): Promise<string> {
    const count = await prisma.client.count({
      where: { organizationId },
    });
    const prefix = 'CLT';
    const number = (count + 1).toString().padStart(6, '0');
    return `${prefix}${number}`;
  }

  /**
   * Generate receipt number
   */
  private async generateReceiptNumber(organizationId: string): Promise<string> {
    // Count all payments (Payment model has no organizationId)
    const count = await prisma.payment.count();
    const prefix = 'RCP';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const number = (count + 1).toString().padStart(6, '0');
    return `${prefix}${date}${number}`;
  }

  /**
   * Generate import template
   */
  generateTemplate(type: ImportType): Buffer {
    const headers = this.getTemplateHeaders(type);
    const sampleData = this.getSampleData(type);

    const ws = XLSX.utils.json_to_sheet([sampleData], { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, type);

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Get template headers for import type
   */
  private getTemplateHeaders(type: ImportType): string[] {
    switch (type) {
      case 'CLIENTS':
        return [
          'First Name',
          'Last Name',
          'ID Number',
          'Phone Number',
          'Email',
          'Gender',
          'Date of Birth',
          'Address',
          'City',
          'Employer ID',
          'Employee Number',
          'Branch ID',
        ];
      case 'PAYMENTS':
        return [
          'Loan Number',
          'Amount',
          'Payment Date',
          'Payment Method',
          'Reference',
          'Notes',
        ];
      case 'EMPLOYERS':
        return [
          'Name',
          'Registration Number',
          'Contact Person',
          'Contact Phone',
          'Contact Email',
          'Address',
          'Payroll Day',
          'Is Active',
        ];
      case 'BRANCHES':
        return [
          'Name',
          'Code',
          'Address',
          'City',
          'Phone',
          'Email',
          'Manager ID',
          'Is Active',
        ];
      default:
        return [];
    }
  }

  /**
   * Get sample data for template
   */
  private getSampleData(type: ImportType): Record<string, any> {
    switch (type) {
      case 'CLIENTS':
        return {
          'First Name': 'John',
          'Last Name': 'Doe',
          'ID Number': 'ID123456',
          'Phone Number': '+263771234567',
          'Email': 'john.doe@example.com',
          'Gender': 'MALE',
          'Date of Birth': '1990-01-15',
          'Address': '123 Main Street',
          'City': 'Harare',
          'Employer ID': '',
          'Employee Number': '',
          'Branch ID': '',
        };
      case 'PAYMENTS':
        return {
          'Loan Number': 'LN-20240001',
          'Amount': 500.00,
          'Payment Date': '2024-01-15',
          'Payment Method': 'CASH',
          'Reference': 'REF123',
          'Notes': 'Monthly payment',
        };
      case 'EMPLOYERS':
        return {
          'Name': 'Acme Corporation',
          'Registration Number': 'REG123456',
          'Contact Person': 'Jane Smith',
          'Contact Phone': '+263772345678',
          'Contact Email': 'jane@acme.com',
          'Address': '456 Corporate Drive',
          'Payroll Day': 25,
          'Is Active': true,
        };
      case 'BRANCHES':
        return {
          'Name': 'Main Branch',
          'Code': 'MAIN',
          'Address': '789 Business Avenue',
          'City': 'Harare',
          'Phone': '+263773456789',
          'Email': 'main@microfinex.com',
          'Manager ID': '',
          'Is Active': true,
        };
      default:
        return {};
    }
  }

  /**
   * Get import type options
   */
  getImportTypes(): Array<{ type: ImportType; name: string; description: string }> {
    return [
      {
        type: 'CLIENTS',
        name: 'Clients',
        description: 'Import client/customer records',
      },
      {
        type: 'PAYMENTS',
        name: 'Payments',
        description: 'Import historical payment records',
      },
      {
        type: 'EMPLOYERS',
        name: 'Employers',
        description: 'Import employer records for payroll deduction',
      },
      {
        type: 'BRANCHES',
        name: 'Branches',
        description: 'Import branch/office records',
      },
    ];
  }
}

export const importService = new ImportService();
