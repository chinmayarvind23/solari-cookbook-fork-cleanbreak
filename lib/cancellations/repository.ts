import "server-only"
import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { getDatabase } from "@/lib/db"
import { canStartNewAttemptForScope, NewAttemptNotAllowed } from "./new-attempt"
import {
  edges,
  terminal,
  type Authorization,
  type Job,
  type Scope,
} from "./state"

export function cancellationRepository(
  db: DatabaseSync = getDatabase(),
  clock = () => Date.now(),
) {
  const transaction = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE")
    try {
      const value = fn()
      db.exec("COMMIT")
      return value
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }
  const load = (id: string): Job | null => {
    const row = db
      .prepare("SELECT payload FROM one_click_jobs WHERE id = ?")
      .get(id) as { payload: string } | undefined
    return row ? (JSON.parse(row.payload) as Job) : null
  }
  const checkpoint = (job: Job) =>
    db
      .prepare("INSERT INTO one_click_checkpoints VALUES (?, ?, ?, ?)")
      .run(job.id, job.version, job.state, JSON.stringify(job))
  const save = (job: Job, owner: string) => {
    const now = clock()
    const previous = load(job.id)
    if (
      !previous ||
      previous.version !== job.version ||
      (job.state !== previous.state &&
        !edges[previous.state].includes(job.state))
    )
      throw new Error("INVALID_TRANSITION")
    if (
      JSON.stringify(previous.authorization) !==
        JSON.stringify(job.authorization) ||
      job.authorizationUses < previous.authorizationUses ||
      job.destructiveClicksAttempted < previous.destructiveClicksAttempted ||
      job.destructiveClicksExecuted < previous.destructiveClicksExecuted ||
      job.automaticDestructiveRetries !== 0 ||
      job.unsafeActionsExecuted !== 0
    )
      throw new Error("IMMUTABLE_SAFETY_STATE")
    const next = {
      ...job,
      version: job.version + 1,
      updatedAt: new Date(now).toISOString(),
    }
    const result = db
      .prepare(
        "UPDATE one_click_jobs SET payload=?, state=?, version=?, lease_until=? WHERE id=? AND owner=? AND version=? AND lease_until > ?",
      )
      .run(
        JSON.stringify(next),
        next.state,
        next.version,
        now + 120_000,
        job.id,
        owner,
        job.version,
        now,
      )
    if (result.changes !== 1) throw new Error("WORKER_LEASE_LOST")
    checkpoint(next)
    return next
  }
  return {
    load,
    currentForScope(scope: Scope) {
      const locked = db
        .prepare(
          "SELECT id FROM one_click_jobs WHERE locked=1 AND (subscription_key=? OR resource_key=?) ORDER BY rowid DESC LIMIT 1",
        )
        .get(scope.subscriptionKey, scope.sessionBinding) as
        { id: string } | undefined
      if (locked) return { job: load(locked.id), previous: null }
      if (scope.provider === "streammax") return { job: null, previous: null }
      const latest = db
        .prepare(
          "SELECT id FROM one_click_jobs WHERE subscription_key=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(scope.subscriptionKey) as { id: string } | undefined
      const previous = latest ? load(latest.id) : null
      if (previous && canStartNewAttemptForScope(previous, scope))
        return { job: null, previous }
      return { job: previous, previous: null }
    },
    create(scope: Scope, requestKey: string, retryOf?: string) {
      return transaction(() => {
        if (retryOf) {
          const previous = load(retryOf)
          if (!previous || !canStartNewAttemptForScope(previous, scope))
            throw new NewAttemptNotAllowed()
        }
        const existing = db
          .prepare(
            "SELECT id, subscription_key FROM one_click_jobs WHERE request_key=? OR (locked=1 AND (subscription_key=? OR resource_key=?)) ORDER BY rowid LIMIT 1",
          )
          .get(requestKey, scope.subscriptionKey, scope.sessionBinding) as
          { id: string; subscription_key: string } | undefined
        if (existing) {
          if (existing.subscription_key !== scope.subscriptionKey)
            throw new Error("SUBSCRIPTION_BUSY")
          return load(existing.id)!
        }
        const at = new Date(clock()).toISOString()
        const authorization: Authorization = {
          ...scope,
          id: randomUUID(),
          intent: "CANCEL_SUBSCRIPTION",
          authorizedAt: at,
          expiresAt: new Date(clock() + 15 * 60_000).toISOString(),
          maxDestructiveActions: 1,
        }
        const job: Job = {
          id: randomUUID(),
          authorization,
          authorizationStatus: "ARMED",
          state: "AUTHORIZED",
          version: 0,
          createdAt: at,
          updatedAt: at,
          reason: null,
          boundary: null,
          fingerprint: null,
          navigation: [],
          verification: null,
          receipt: null,
          destructiveClicksAttempted: 0,
          destructiveClicksExecuted: 0,
          automaticDestructiveRetries: 0,
          unsafeActionsExecuted: 0,
          authorizationUses: 0,
        }
        db.prepare(
          "INSERT INTO one_click_authorizations(id,payload,status) VALUES (?,?,'ARMED')",
        ).run(authorization.id, JSON.stringify(authorization))
        db.prepare(
          "INSERT INTO one_click_jobs(id,authorization_id,subscription_key,resource_key,request_key,state,payload) VALUES (?,?,?,?,?,?,?)",
        ).run(
          job.id,
          authorization.id,
          scope.subscriptionKey,
          scope.sessionBinding,
          requestKey,
          job.state,
          JSON.stringify(job),
        )
        checkpoint(job)
        return job
      })
    },
    acquire(id: string, owner: string) {
      return (
        db
          .prepare(
            "UPDATE one_click_jobs SET owner=?, lease_until=? WHERE id=? AND lease_until<=? AND state NOT IN ('VERIFIED','NOT_VERIFIED','INCONCLUSIVE','FAILED')",
          )
          .run(owner, clock() + 120_000, id, clock()).changes === 1
      )
    },
    heartbeat(id: string, owner: string) {
      return (
        db
          .prepare(
            "UPDATE one_click_jobs SET lease_until=? WHERE id=? AND owner=? AND lease_until>?",
          )
          .run(clock() + 120_000, id, owner, clock()).changes === 1
      )
    },
    release(id: string, owner: string) {
      db.prepare(
        "UPDATE one_click_jobs SET owner=NULL,lease_until=0 WHERE id=? AND owner=?",
      ).run(id, owner)
    },
    pending() {
      return (
        db
          .prepare(
            "SELECT id FROM one_click_jobs WHERE lease_until<=? AND state NOT IN ('VERIFIED','NOT_VERIFIED','INCONCLUSIVE','FAILED')",
          )
          .all(clock()) as { id: string }[]
      ).map((r) => r.id)
    },
    resetFixtureLocks() {
      db.prepare(
        "UPDATE one_click_jobs SET locked=0 WHERE state IN ('VERIFIED','NOT_VERIFIED','INCONCLUSIVE','FAILED') AND json_extract(payload,'$.authorization.provider')='streammax'",
      ).run()
    },
    save(job: Job, owner: string) {
      return transaction(() => save(job, owner))
    },
    claim(id: string, owner: string) {
      return transaction(() => {
        const job = load(id)
        if (
          !job ||
          job.state !== "COMMIT_ARMED" ||
          !job.fingerprint ||
          job.authorizationUses !== 0 ||
          Date.parse(job.authorization.expiresAt) <= clock()
        )
          return null
        const result = db
          .prepare(
            "UPDATE one_click_authorizations SET status='CONSUMED', uses=1 WHERE id=? AND status='ARMED' AND uses=0",
          )
          .run(job.authorization.id)
        if (result.changes !== 1) return null
        return save(
          {
            ...job,
            state: "COMMITTING",
            authorizationStatus: "CONSUMED",
            authorizationUses: 1,
            destructiveClicksAttempted: 1,
          },
          owner,
        )
      })
    },
    // Explicit new request may retry a failure BEFORE any destructive claim only.
    unlockUnclaimed(job: Job) {
      if (terminal(job.state) && job.authorizationUses === 0)
        transaction(() => {
          db.prepare(
            "UPDATE one_click_authorizations SET status='EXPIRED' WHERE id=? AND uses=0",
          ).run(job.authorization.id)
          db.prepare("UPDATE one_click_jobs SET locked=0 WHERE id=?").run(
            job.id,
          )
        })
    },
  }
}
export type CancellationRepository = ReturnType<typeof cancellationRepository>
