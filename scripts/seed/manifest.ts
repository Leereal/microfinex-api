import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '../../src/config/database';

/**
 * A record of everything one seed run created, so it can be undone exactly.
 *
 * The rule this exists to keep: a rollback must remove what the seeder added
 * and nothing else. Deleting by "everything that looks like demo data" would
 * eventually take a real client with it, so instead every insert is written
 * down here by model and id, in the order it happened. Rolling back walks the
 * list backwards, which unwinds children before the parents they point at.
 *
 * Durability matters as much as the record itself: a run that dies partway
 * through must still be undoable. Flushing once per phase was not enough - a
 * crash mid-phase left rows in the database that no manifest mentioned, which
 * is precisely the orphan this file exists to prevent. Writes are now debounced
 * by count, and the seeder flushes from a `finally`, so the worst case is a
 * handful of rows rather than a whole phase.
 */

export const SEED_RUN_DIR = path.join(__dirname, '..', '..', 'prisma', 'seed-runs');

/** Prisma model names, in the order the seeder creates them. */
export type SeedModel =
  | 'employer'
  | 'client'
  | 'clientAddress'
  | 'clientContact'
  | 'clientBusiness'
  | 'nextOfKin'
  | 'clientEmployer'
  | 'clientLimit'
  | 'clientDocument'
  | 'clientCollateral'
  | 'group'
  | 'groupMember'
  | 'loan'
  | 'repaymentSchedule'
  | 'payment'
  | 'loanCharge'
  | 'loanAssessment'
  | 'loanVisit'
  | 'securityPledge'
  | 'loanWorkflowHistory'
  | 'financialTransaction'
  | 'exchangeRate'
  | 'monthlyTarget'
  | 'onlineApplication'
  | 'note'
  | 'shop'
  | 'shopProduct'
  | 'loanItem'
  | 'clientDraft'
  | 'notification'
  | 'clientDeletionRequest'
  | 'auditLog';

export interface SeedEntry {
  model: SeedModel;
  id: string;
  /** Human-readable, so the manifest can be read without the database. */
  label?: string;
}

export interface SeedManifest {
  batchId: string;
  startedAt: string;
  finishedAt?: string;
  organizationId: string;
  organizationName: string;
  /** Whether the personas came from the model or the local fallback. */
  aiProvider?: string;
  entries: SeedEntry[];
  summary?: Record<string, number>;
}

export class Manifest {
  private readonly entries: SeedEntry[] = [];

  constructor(
    readonly batchId: string,
    private readonly meta: {
      organizationId: string;
      organizationName: string;
      aiProvider?: string;
    }
  ) {
    if (!existsSync(SEED_RUN_DIR)) mkdirSync(SEED_RUN_DIR, { recursive: true });
  }

  get file(): string {
    return path.join(SEED_RUN_DIR, `${this.batchId}.json`);
  }

  get count(): number {
    return this.entries.length;
  }

  /** Note a created row. Call this for every insert, without exception. */
  record(model: SeedModel, id: string, label?: string): string {
    this.entries.push({ model, id, label });

    // Debounced rather than every row: a seed run makes thousands of inserts
    // and rewriting the file each time dominates the runtime. Ten rows is a
    // small enough window to clean up by hand if the process is killed
    // outright (a `finally` cannot help with SIGKILL).
    if (this.entries.length - this.lastFlushed >= 10) this.flush();

    return id;
  }

  recordMany(model: SeedModel, ids: string[]): void {
    for (const id of ids) this.entries.push({ model, id });
  }

  setAiProvider(provider: string) {
    this.meta.aiProvider = provider;
  }

  /** Per-model totals, for the run summary. */
  tally(): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const entry of this.entries) {
      totals[entry.model] = (totals[entry.model] ?? 0) + 1;
    }
    return totals;
  }

  /** Write the manifest out. Safe to call repeatedly; call it often. */
  flush(finished = false): void {
    const manifest: SeedManifest = {
      batchId: this.batchId,
      startedAt: this.startedAt,
      ...(finished ? { finishedAt: new Date().toISOString() } : {}),
      organizationId: this.meta.organizationId,
      organizationName: this.meta.organizationName,
      aiProvider: this.meta.aiProvider,
      entries: this.entries,
      summary: this.tally(),
    };
    writeFileSync(this.file, JSON.stringify(manifest, null, 2), 'utf8');
    this.lastFlushed = this.entries.length;
  }

  private lastFlushed = 0;

  private readonly startedAt = new Date().toISOString();
}

export function loadManifest(batchId: string): SeedManifest {
  const file = path.join(SEED_RUN_DIR, `${batchId}.json`);
  if (!existsSync(file)) {
    throw new Error(`No seed run named "${batchId}" in ${SEED_RUN_DIR}`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as SeedManifest;
}

/**
 * Undo a seed run.
 *
 * Deletes strictly in reverse creation order and strictly by id. A row already
 * gone - removed by hand, or taken by a cascade from its parent - is counted as
 * skipped rather than treated as a failure, because the goal is "none of this
 * remains", not "every delete found something".
 */
export async function rollback(
  batchId: string,
  options: { dryRun?: boolean } = {}
): Promise<{ deleted: number; skipped: number; failed: SeedEntry[] }> {
  const manifest = loadManifest(batchId);
  const reversed = [...manifest.entries].reverse();

  let deleted = 0;
  let skipped = 0;
  const failed: SeedEntry[] = [];

  for (const entry of reversed) {
    if (options.dryRun) {
      deleted++;
      continue;
    }

    try {
      const delegate = (prisma as any)[entry.model];
      if (!delegate?.delete) {
        failed.push(entry);
        continue;
      }
      await delegate.delete({ where: { id: entry.id } });
      deleted++;
    } catch (error: any) {
      // P2025: already gone, which is the outcome we wanted anyway.
      if (error?.code === 'P2025') {
        skipped++;
        continue;
      }
      failed.push(entry);
    }
  }

  return { deleted, skipped, failed };
}
