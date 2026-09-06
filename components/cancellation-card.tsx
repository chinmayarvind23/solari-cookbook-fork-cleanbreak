"use client"
import { useEffect, useRef, useState } from "react"
import type { PublicCancellation } from "@/lib/cancellations/public"
import { terminal, type Provider } from "@/lib/cancellations/state"
import { cancellationStartError } from "@/lib/cancellations/start-feedback"
export function CancellationCard({
  provider,
  planName,
  amountCents,
  currency,
  interval,
  enabled,
  initialJob = null,
  previousAttempt = null,
  requestScopeKey,
}: {
  provider: Provider
  planName: string
  amountCents: number
  currency: string
  interval: string
  enabled: boolean
  initialJob?: PublicCancellation | null
  previousAttempt?: PublicCancellation | null
  requestScopeKey?: string
}) {
  const [job, setJob] = useState<PublicCancellation | null>(initialJob)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const sending = useRef(false)
  const storageKey = `cleanbreak-cancellation-${provider}${requestScopeKey ? `-${requestScopeKey}` : ""}`
  useEffect(() => {
    if (busy) return
    let canceled = false,
      timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const ticket = JSON.parse(
          localStorage.getItem(storageKey) || "null",
        ) as { id?: string } | null
        // Server state is authoritative for scoped cards. Old browser tickets
        // remain recoverable but cannot restore a retired VM's failed card.
        const id = requestScopeKey ? (job?.id ?? initialJob?.id) : ticket?.id
        if (!id || id === previousAttempt?.id) return
        const response = await fetch(`/api/cancellations/${id}`, {
          cache: "no-store",
        })
        if (!response.ok) throw new Error()
        const value = (await response.json()) as PublicCancellation
        if (canceled) return
        setJob(value)
        if (!terminal(value.state) || value.recordingStatus === "RECORDING")
          timer = setTimeout(poll, 1500)
      } catch {
        if (!canceled) {
          setError(
            "Status unavailable. Refresh to reconnect; do not submit another cancellation.",
          )
          timer = setTimeout(poll, 3000)
        }
      }
    }
    void poll()
    return () => {
      canceled = true
      clearTimeout(timer)
    }
  }, [
    storageKey,
    busy,
    job?.id,
    initialJob?.id,
    previousAttempt?.id,
    requestScopeKey,
  ])
  async function cancel(retryOf?: string) {
    if (sending.current || !enabled) return
    if (
      retryOf &&
      !(
        (job?.id === retryOf && job.canStartNewAttempt) ||
        previousAttempt?.id === retryOf
      )
    )
      return
    sending.current = true
    setBusy(true)
    setError("")
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null") as {
        key?: string
        retryOf?: string
      } | null
      const key =
        retryOf && saved?.retryOf !== retryOf
          ? crypto.randomUUID()
          : saved?.key || crypto.randomUUID()
      // Retain the predecessor and same pending key if the response is lost.
      // An explicit subsequent click reuses this key, never silently rotates it.
      localStorage.setItem(
        storageKey,
        JSON.stringify({ key, ...(retryOf ? { id: retryOf, retryOf } : {}) }),
      )
      const response = await fetch("/api/cancellations", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          provider,
          ...(retryOf ? { retryOf } : {}),
          ...(requestScopeKey ? { scopeKey: requestScopeKey } : {}),
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        setError(cancellationStartError(response.status, body?.error))
        return
      }
      const value = (await response.json()) as PublicCancellation
      localStorage.setItem(storageKey, JSON.stringify({ key, id: value.id }))
      setJob(value)
    } catch {
      setError(
        "Cancellation request was not confirmed. Check that browser storage is enabled, then refresh to reconnect with the same request key. Do not submit a new cancellation.",
      )
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <article className="subscription-card cancellation-card">
      <div className="cancellation-content">
        <p className="eyebrow">
          {provider === "miro"
            ? "Recorded autonomous cancellation"
            : "Local one-click test — no external account"}
        </p>
        <h3>{provider === "miro" ? "Miro" : "StreamMax"}</h3>
        <p>{planName}</p>
        {provider === "miro" && enabled && (
          <p className="cancellation-notice" role="note">
            Live cancellation — this button authorizes one irreversible
            cancellation attempt. CleanBreak will not ask for a second approval
            and will never retry an uncertain final click. A receipt requires
            independent verification.
          </p>
        )}
        <p className="cancellation-price">
          Renews/charges:{" "}
          {new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
          }).format(amountCents / 100)}{" "}
          {interval.toLowerCase()}
        </p>
        <p>
          Authorize one cancellation attempt to stop this subscription’s future
          renewal, preserving prepaid access. Unexpected fees or changed terms
          stop the job.
        </p>
        {job ? (
          <div className="cancellation-status" role="status">
            <strong>{job.state.replaceAll("_", " ")}</strong>
            <p>{job.message}</p>
            {job.reason && <p>{job.reason}</p>}
            {job.canStartNewAttempt && enabled && (
              <>
                <p>
                  No destructive click was attempted. CleanBreak opens Billing
                  automatically. This button authorizes a new one-shot attempt;
                  it does not resume the failed job.
                </p>
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => cancel(job.id)}
                >
                  {busy ? "Authorizing..." : "Start a new cancellation attempt"}
                </button>
              </>
            )}
            {job.receiptUrl && (
              <a className="primary-button" href={job.receiptUrl}>
                View receipt
              </a>
            )}
            {job.recordingUrl && (
              <a className="secondary-button" href={job.recordingUrl}>
                {job.state === "VERIFIED"
                  ? "Download full recording"
                  : "Download attempt recording"}
              </a>
            )}
            {terminal(job.state) && job.recordingStatus === "RECORDING" && (
              <p>Saving the recording...</p>
            )}
            {job.recordingStatus === "FAILED" && (
              <p>
                The recording could not be saved. This does not authorize
                another cancellation attempt.
              </p>
            )}
          </div>
        ) : (
          <button
            className="primary-button"
            type="button"
            disabled={!enabled || busy}
            onClick={() => cancel(previousAttempt?.id)}
          >
            {!enabled
              ? "Live setup required"
              : busy
                ? "Authorizing..."
                : "Cancel subscription"}
          </button>
        )}
        {!job && previousAttempt && (
          <details>
            <summary>
              Previous attempt — no cancellation click was attempted
            </summary>
            <p>
              {previousAttempt.reason}. Its history is preserved. Clicking
              Cancel subscription creates a fresh authorization for the current
              session.
            </p>
          </details>
        )}
        {!enabled && (
          <p>
            Live cancellation is disabled. The developer dry-run never submits
            cancellation. Enable the three explicit live-mode flags and operator
            authentication on the server to use this one-click product flow.{" "}
            Stop the existing web server and run <code>npm run dev:live</code>,
            then open the exact address printed in that terminal.
          </p>
        )}
        {busy && (
          <p role="status">
            Submitting authorization. Please wait; do not click again.
          </p>
        )}
        {error && (
          <p className="cancellation-notice" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  )
}
