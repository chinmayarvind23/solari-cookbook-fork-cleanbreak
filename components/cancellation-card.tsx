"use client"
import { useEffect, useRef, useState } from "react"
import type { PublicCancellation } from "@/lib/cancellations/public"
import { terminal, type Provider } from "@/lib/cancellations/state"
export function CancellationCard({
  provider,
  planName,
  amountCents,
  currency,
  interval,
  enabled,
}: {
  provider: Provider
  planName: string
  amountCents: number
  currency: string
  interval: string
  enabled: boolean
}) {
  const [job, setJob] = useState<PublicCancellation | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const sending = useRef(false)
  const storageKey = `cleanbreak-cancellation-${provider}`
  useEffect(() => {
    let canceled = false,
      timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const ticket = JSON.parse(
          localStorage.getItem(storageKey) || "null",
        ) as { id?: string } | null
        if (!ticket?.id) return
        const response = await fetch(`/api/cancellations/${ticket.id}`, {
          cache: "no-store",
        })
        if (!response.ok) throw new Error()
        const value = (await response.json()) as PublicCancellation
        if (canceled) return
        setJob(value)
        if (!terminal(value.state)) timer = setTimeout(poll, 1500)
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
  }, [storageKey, busy])
  async function cancel() {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError("")
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null") as {
        key?: string
      } | null
      const key = saved?.key || crypto.randomUUID()
      localStorage.setItem(storageKey, JSON.stringify({ key }))
      const response = await fetch("/api/cancellations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ provider }),
      })
      if (!response.ok) throw new Error()
      const value = (await response.json()) as PublicCancellation
      localStorage.setItem(storageKey, JSON.stringify({ key, id: value.id }))
      setJob(value)
    } catch {
      setError(
        "Cancellation could not be started. Check configuration or retry with the same request key.",
      )
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <article className="subscription-card">
      <div className="subscription-main">
        <p className="eyebrow">
          {provider === "miro"
            ? "Configured dedicated Desktop"
            : "Local one-click test — no external account"}
        </p>
        <h3>{provider === "miro" ? "Miro" : "StreamMax"}</h3>
        <p>{planName}</p>
        {provider === "miro" && enabled && (
          <p role="note">
            Live cancellation — this button authorizes one irreversible
            cancellation attempt. CleanBreak will not ask for a second approval
            and will never retry an uncertain final click. A receipt requires
            independent verification.
          </p>
        )}
        <p>
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
          <div role="status">
            <strong>{job.state.replaceAll("_", " ")}</strong>
            <p>{job.message}</p>
            {job.reason && <p>{job.reason}</p>}
            {job.receiptUrl && (
              <a className="primary-button" href={job.receiptUrl}>
                View receipt
              </a>
            )}
          </div>
        ) : (
          <button
            className="primary-button"
            type="button"
            disabled={!enabled || busy}
            onClick={cancel}
          >
            {busy ? "Authorizing..." : "Cancel subscription"}
          </button>
        )}
        {!enabled && (
          <p>
            Live cancellation is disabled. The developer dry-run never submits
            cancellation. Enable the three explicit live-mode flags and operator
            authentication on the server to use this one-click product flow.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </article>
  )
}
