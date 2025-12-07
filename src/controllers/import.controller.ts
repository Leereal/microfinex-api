/**
 * Import Controller
 * Handles HTTP requests for CSV/Excel client data imports
 */

import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { ImportType, ImportStatus } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

interface ImportRow {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  idNumber?: string;
  address?: string;
  city?: string;
  country?: string;
  [key: string]: string | undefined;
}

class ImportController {
  /**
   * Start a client import job
   * POST /api/v1/imports/clients
   */
  async startImport(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.userId;
      const { fileContent, fileName, importType, branchId, dryRun } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!fileContent || !fileName) {
        return res.status(400).json({
          success: false,
          message: 'File content and name are required',
          error: 'MISSING_FILE',
          timestamp: new Date().toISOString(),
        });
      }

      // Determine import type from file extension
      const extension = fileName.toLowerCase().split('.').pop();
      let type: ImportType;

      if (extension === 'csv' || extension === 'xlsx' || extension === 'xls') {
        type = ImportType.CLIENTS; // Map file imports to CLIENTS type
      } else {
        return res.status(400).json({
          success: false,
          message: 'Unsupported file type. Use CSV or Excel files.',
          error: 'UNSUPPORTED_FILE_TYPE',
          timestamp: new Date().toISOString(),
        });
      }

      // Create import job record
        const importJob = await prisma.importJob.create({
        data: {
          organizationId,
          importType: type,
          fileName,
          originalFileName: fileName,
          storagePath: '',
          status: ImportStatus.PENDING,
          createdBy: userId!,
          mapping: {
            branchId,
            dryRun: dryRun ?? false,
          },
        },
      });      // Parse and process file
      try {
        let rows: ImportRow[];

        if (extension === 'csv') {
          // Decode base64 content if needed
          const content = fileContent.startsWith('data:')
            ? Buffer.from(fileContent.split(',')[1], 'base64').toString('utf-8')
            : fileContent;

          rows = parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
          });
        } else {
          // Parse Excel file
          const content = fileContent.startsWith('data:')
            ? fileContent.split(',')[1]
            : fileContent;

          const buffer = Buffer.from(content, 'base64');
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          rows = XLSX.utils.sheet_to_json<ImportRow>(worksheet);
        }

        // Update job with total rows
        await prisma.importJob.update({
          where: { id: importJob.id },
          data: {
            totalRows: rows.length,
            status: ImportStatus.PROCESSING,
            startedAt: new Date(),
          },
        });

        // Validate and process rows
        const results = await this.processImportRows(
          rows,
          importJob.id,
          organizationId,
          branchId,
          dryRun ?? false
        );

        // Update job with results
        await prisma.importJob.update({
          where: { id: importJob.id },
          data: {
            processedRows: results.processed,
            successfulRows: results.successful,
            failedRows: results.failed,
            status:
              results.failed > 0
                ? ImportStatus.PARTIALLY_COMPLETED
                : ImportStatus.COMPLETED,
            completedAt: new Date(),
          },
        });

        const updatedJob = await prisma.importJob.findUnique({
          where: { id: importJobId },
        });

        res.status(201).json({
          success: true,
          message: dryRun
            ? 'Dry run completed'
            : `Import completed: ${results.successful} successful, ${results.failed} failed`,
          data: {
            job: updatedJob,
            summary: results,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (parseError: any) {
        // Update job with error status
        await prisma.importJob.update({
          where: { id: importJobId },
          data: {
            status: ImportStatus.FAILED,
            completedAt: new Date(),
            errorLog: [
              {
                rowNumber: 0,
                rowData: {},
                errorMessage: `File parsing error: ${parseError.message}`,
              },
            ],
          },
        });

        return res.status(400).json({
          success: false,
          message: `Failed to parse file: ${parseError.message}`,
          error: 'PARSE_ERROR',
          data: { jobId: importJobId },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Start import error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start import',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Process import rows
   */
  private async processImportRows(
    rows: ImportRow[],
    importJobId: string,
    organizationId: string,
    branchId?: string,
    dryRun: boolean = false
  ): Promise<{
    processed: number;
    successful: number;
    failed: number;
    clients: string[];
  }> {
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      clients: [] as string[],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!; // Assert defined since we're iterating array.length
      const rowNumber = i + 1; // 1-indexed for user display
      results.processed++;

      try {
        // Validate required fields
        const errors: string[] = [];

        if (!row.firstName?.trim()) {
          errors.push('First name is required');
        }
        if (!row.lastName?.trim()) {
          errors.push('Last name is required');
        }

        // Validate email format if provided
        if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
          errors.push('Invalid email format');
        }

        // Validate date of birth if provided
        let dateOfBirth: Date | null = null;
        if (row.dateOfBirth) {
          dateOfBirth = new Date(row.dateOfBirth);
          if (isNaN(dateOfBirth.getTime())) {
            errors.push('Invalid date of birth format');
          } else {
            // Check if 18+
            const age = Math.floor(
              (Date.now() - dateOfBirth.getTime()) /
                (365.25 * 24 * 60 * 60 * 1000)
            );
            if (age < 18) {
              errors.push('Client must be 18 years or older');
            }
          }
        }

        // Validate gender if provided
        const validGenders = ['MALE', 'FEMALE', 'OTHER'];
        if (row.gender && !validGenders.includes(row.gender.toUpperCase())) {
          errors.push('Gender must be MALE, FEMALE, or OTHER');
        }

        // Check for duplicate email if provided
        if (row.email && !dryRun) {
          const existingClient = await prisma.client.findFirst({
            where: {
              organizationId,
              email: row.email,
            },
          });

          if (existingClient) {
            errors.push(`Client with email ${row.email} already exists`);
          }
        }

        // Check for duplicate ID number if provided
        if (row.idNumber && !dryRun) {
          const existingClient = await prisma.client.findFirst({
            where: {
              organizationId,
              idNumber: row.idNumber,
            },
          });

          if (existingClient) {
            errors.push(`Client with ID number ${row.idNumber} already exists`);
          }
        }

        if (errors.length > 0) {
          // Store errors in errorLog for the import job
          const currentErrors = importJob.errorLog as any || [];
          for (const errorMessage of errors) {
            currentErrors.push({
              rowNumber,
              rowData: row,
              errorMessage,
            });
          }
          // Update import job with errors
          await prisma.importJob.update({
            where: { id: importJobId },
            data: { errorLog: currentErrors },
          });
          results.failed++;
          continue;
        }

        // Create client if not dry run
        if (!dryRun) {
          const client = await prisma.client.create({
            data: {
              organizationId,
              branchId,
              firstName: row.firstName.trim(),
              lastName: row.lastName.trim(),
              email: row.email?.trim() || null,
              phone: row.phone?.trim() || null,
              dateOfBirth: dateOfBirth,
              gender: (row.gender?.toUpperCase() as any) || null,
              idNumber: row.idNumber?.trim() || null,
              status: 'ACTIVE',
              metadata: {
                importedAt: new Date().toISOString(),
                importJobId,
              },
            },
          });

          // Create address if provided
          if (row.address || row.city || row.country) {
            await prisma.clientAddress.create({
              data: {
                clientId: client.id,
                addressType: 'RESIDENTIAL',
                addressLine1: row.address?.trim() || '',
                city: row.city?.trim() || '',
                country: row.country?.trim() || 'Zimbabwe',
                isPrimary: true,
              },
            });
          }

          // Create phone contact if provided
          if (row.phone) {
            await prisma.clientContact.create({
              data: {
                clientId: client.id,
                contactType: 'MOBILE',
                contactValue: row.phone.trim(),
                isPrimary: true,
              },
            });
          }

          results.clients.push(client.id);
        }

        results.successful++;
      } catch (error: any) {
        // Record error in import job errorLog
        const currentErrors = importJob.errorLog as any || [];
        currentErrors.push({
          rowNumber,
          rowData: row,
          errorMessage: error.message || 'Unknown error',
        });
        await prisma.importJob.update({
          where: { id: importJobId },
          data: { errorLog: currentErrors },
        });
        results.failed++;
      }
    }

    return results;
  }

  /**
   * Get import job status
   * GET /api/v1/imports/:jobId
   */
  async getImportStatus(req: Request, res: Response) {
    try {
      const { jobId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const job = await prisma.importJob.findFirst({
        where: {
          id: jobId,
          organizationId,
        },
      });

      if (!job) {
        return res.status(404).json({
          success: false,
          message: 'Import job not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Import job retrieved successfully',
        data: { job },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get import status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve import status',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get all import jobs for organization
   * GET /api/v1/imports
   */
  async getImportJobs(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const { page = 1, limit = 20, status } = req.query;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const skip = (Number(page) - 1) * Number(limit);

      const [jobs, total] = await Promise.all([
        prisma.importJob.findMany({
          where: {
            organizationId,
            ...(status && { status: status as ImportStatus }),
          },
          include: {
            createdByUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            _count: {
              select: {
                errors: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          skip,
          take: Number(limit),
        }),
        prisma.importJob.count({
          where: {
            organizationId,
            ...(status && { status: status as ImportStatus }),
          },
        }),
      ]);

      res.json({
        success: true,
        message: 'Import jobs retrieved successfully',
        data: {
          jobs,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit)),
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get import jobs error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve import jobs',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get import template
   * GET /api/v1/imports/template
   */
  async getImportTemplate(req: Request, res: Response) {
    try {
      const { format = 'csv' } = req.query;

      const headers = [
        'firstName',
        'lastName',
        'email',
        'phone',
        'dateOfBirth',
        'gender',
        'idNumber',
        'address',
        'city',
        'country',
      ];

      const sampleData = [
        {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          phone: '+263771234567',
          dateOfBirth: '1990-01-15',
          gender: 'MALE',
          idNumber: '63-123456-A-00',
          address: '123 Main Street',
          city: 'Harare',
          country: 'Zimbabwe',
        },
        {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane.smith@example.com',
          phone: '+263772345678',
          dateOfBirth: '1985-06-20',
          gender: 'FEMALE',
          idNumber: '63-234567-B-00',
          address: '456 Second Avenue',
          city: 'Bulawayo',
          country: 'Zimbabwe',
        },
      ];

      if (format === 'xlsx') {
        // Generate Excel template
        const worksheet = XLSX.utils.json_to_sheet(sampleData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Clients');

        const buffer = XLSX.write(workbook, {
          type: 'buffer',
          bookType: 'xlsx',
        });

        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          'attachment; filename=client_import_template.xlsx'
        );
        res.send(buffer);
      } else {
        // Generate CSV template
        const csvRows = [headers.join(',')];

        for (const row of sampleData) {
          csvRows.push(
            headers.map(h => row[h as keyof typeof row] || '').join(',')
          );
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename=client_import_template.csv'
        );
        res.send(csvRows.join('\n'));
      }
    } catch (error) {
      console.error('Get import template error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate import template',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Cancel an import job
   * POST /api/v1/imports/:jobId/cancel
   */
  async cancelImport(req: Request, res: Response) {
    try {
      const { jobId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const job = await prisma.importJob.findFirst({
        where: {
          id: jobId,
          organizationId,
        },
      });

      if (!job) {
        return res.status(404).json({
          success: false,
          message: 'Import job not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      if (
        job.status !== ImportStatus.PENDING &&
        job.status !== ImportStatus.PROCESSING
      ) {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel a completed or failed job',
          error: 'INVALID_STATUS',
          timestamp: new Date().toISOString(),
        });
      }

      const updatedJob = await prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: ImportStatus.FAILED,
          completedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: 'Import job cancelled successfully',
        data: { job: updatedJob },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Cancel import error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel import',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Delete an import job and its errors
   * DELETE /api/v1/imports/:jobId
   */
  async deleteImport(req: Request, res: Response) {
    try {
      const { jobId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const job = await prisma.importJob.findFirst({
        where: {
          id: jobId,
          organizationId,
        },
      });

      if (!job) {
        return res.status(404).json({
          success: false,
          message: 'Import job not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Delete job (errors are stored in errorLog field, so no cascade needed)
      await prisma.importJob.delete({
        where: { id: jobId },
      });

      res.json({
        success: true,
        message: 'Import job deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Delete import error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete import',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const importController = new ImportController();
