import type { DatabaseSync } from "node:sqlite"

import { getDatabase } from "@/lib/db"
import { canonicalJson } from "@/lib/receipts/canonical"
import type {
  BeforeEvidence,
  CleanBreakReceipt,
  ReceiptGenerationFailure,
  ReceiptPayload,
} from "@/lib/receipts/types"

type Row = Record<string, unknown>

function receiptFrom(row: Row): CleanBreakReceipt {
  return {
    ...(JSON.parse(String(row.canonical_json)) as ReceiptPayload),
    sha256: String(row.sha256),
  }
}

export function createReceiptRepository(
  database: DatabaseSync = getDatabase(),
) {
  return {
    saveBeforeEvidence(jobId: string, evidence: BeforeEvidence): void {
      database
        .prepare(
          `INSERT INTO receipt_before_evidence (
        job_id, plan_name, subscription_status, auto_renew,
        recurring_amount_cents, currency, recurring_interval,
        next_charge_date, observed_url, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          jobId,
          evidence.planName,
          evidence.status,
          evidence.autoRenew === null ? null : Number(evidence.autoRenew),
          evidence.recurringAmountCents,
          evidence.currency,
          evidence.interval,
          evidence.nextChargeDate,
          evidence.url,
          evidence.capturedAt,
        )
    },
    getBeforeEvidence(jobId: string): BeforeEvidence | null {
      const row = database
        .prepare("SELECT * FROM receipt_before_evidence WHERE job_id = ?")
        .get(jobId) as Row | undefined
      return row
        ? {
            planName: String(row.plan_name),
            status: String(row.subscription_status),
            autoRenew: row.auto_renew === null ? null : Boolean(row.auto_renew),
            recurringAmountCents: Number(row.recurring_amount_cents),
            currency: String(row.currency),
            interval: row.recurring_interval as "MONTHLY" | "YEARLY",
            nextChargeDate: (row.next_charge_date as string | null) ?? null,
            url: String(row.observed_url),
            capturedAt: String(row.captured_at),
          }
        : null
    },
    insert(payload: ReceiptPayload, sha256: string): void {
      database
        .prepare(
          `INSERT OR IGNORE INTO cleanbreak_receipts (
        id, job_id, subscription_id, created_at, canonical_version,
        canonical_json, sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          payload.receiptId,
          payload.jobId,
          payload.subscriptionId,
          payload.createdAt,
          payload.canonicalVersion,
          canonicalJson(payload),
          sha256,
        )
      database
        .prepare("DELETE FROM receipt_generation_failures WHERE job_id = ?")
        .run(payload.jobId)
    },
    getById(id: string): CleanBreakReceipt | null {
      const row = database
        .prepare("SELECT * FROM cleanbreak_receipts WHERE id = ?")
        .get(id) as Row | undefined
      return row ? receiptFrom(row) : null
    },
    getByJobId(jobId: string): CleanBreakReceipt | null {
      const row = database
        .prepare("SELECT * FROM cleanbreak_receipts WHERE job_id = ?")
        .get(jobId) as Row | undefined
      return row ? receiptFrom(row) : null
    },
    getLatestForSubscription(subscriptionId: string): CleanBreakReceipt | null {
      const row = database
        .prepare(
          `SELECT * FROM cleanbreak_receipts
        WHERE subscription_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(subscriptionId) as Row | undefined
      return row ? receiptFrom(row) : null
    },
    recordFailure(
      jobId: string,
      code: string,
      message: string,
      failedAt: string,
    ): void {
      database
        .prepare(
          `INSERT INTO receipt_generation_failures (
        job_id, attempts, error_code, error_message, failed_at
      ) VALUES (?, 1, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET attempts = attempts + 1,
        error_code = excluded.error_code, error_message = excluded.error_message,
        failed_at = excluded.failed_at`,
        )
        .run(jobId, code, message, failedAt)
    },
    getFailure(jobId: string): ReceiptGenerationFailure | null {
      const row = database
        .prepare("SELECT * FROM receipt_generation_failures WHERE job_id = ?")
        .get(jobId) as Row | undefined
      return row
        ? {
            jobId: String(row.job_id),
            attempts: Number(row.attempts),
            errorCode: String(row.error_code),
            errorMessage: String(row.error_message),
            failedAt: String(row.failed_at),
          }
        : null
    },
  }
}

export type ReceiptRepository = ReturnType<typeof createReceiptRepository>
