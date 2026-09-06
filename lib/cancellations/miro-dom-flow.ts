// Recognize the supported Miro dialog stages and their specific controls.
import "server-only"
import { createHash } from "node:crypto"
import type { Page } from "playwright-core"
import { evaluateLocalDOM } from "@/lib/desktop/local-dom"

export const DOM_NEUTRAL_REASON = "I no longer need this subscription."
export type MiroDOMStage =
  | "ENTRY"
  | "BENEFITS"
  | "DECLINE_OFFER"
  | "CANCEL_CHOICE"
  | "REASON_NEXT"
  | "REASON_INPUT"
  | "FINAL"

// Static, provider-specific DOM structure observed on the configured Miro trial.
// No page text, arbitrary selectors, instructions, or input values leave Chrome.
export async function readMiroTrialDOM(
  page: Page,
  expectedUrl: string,
  scrollTarget = false,
) {
  const facts = await evaluateLocalDOM(
    page,
    async ({ expectedUrl, scrollTarget, neutral }) => {
      const actual = new URL(location.href),
        expected = new URL(expectedUrl)
      const matched =
        actual.origin === "https://miro.com" &&
        actual.origin === expected.origin &&
        actual.pathname.replace(/\/$/, "") ===
          expected.pathname.replace(/\/$/, "") &&
        !actual.search &&
        !actual.hash &&
        !actual.username &&
        !actual.password
      const visible = (n: Element) =>
        !!n.getClientRects().length &&
        getComputedStyle(n).display !== "none" &&
        getComputedStyle(n).visibility !== "hidden"
      const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim()
      const one = (selector: string, root: ParentNode = document) => {
        const nodes = Array.from(root.querySelectorAll(selector)).filter(
          visible,
        )
        return nodes.length === 1 ? nodes[0] : null
      }
      const events = one('[data-testid="billing-overview__next-events"]')
      const summary = one(
        '[data-testid="settings__billing-overview__plan-summary__without-flp-link"]',
      )
      const next = norm(events?.textContent ?? null),
        plan = norm(summary?.textContent ?? null)
      const trial = /\bbusiness(?: plan)? trial\b/i.test(next)
      const interval =
        /\byearly\b/i.test(plan) && !/\bmonthly\b/i.test(plan)
          ? "YEARLY"
          : /\bmonthly\b/i.test(plan) && !/\byearly\b/i.test(plan)
            ? "MONTHLY"
            : "UNKNOWN"
      const amountMatch = next.match(
        /\bcharged\s*(USD\s*|US\$\s*|\$\s*)([\d,]+(?:\.\d{2})?)(?!\d)/i,
      )
      const amount = amountMatch
        ? Math.round(Number(amountMatch[2].replace(/,/g, "")) * 100)
        : null
      const months = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
      ]
      const dateMatch = next.match(
        /\b(?:ends|expires)\s+(?:on\s+)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/i,
      )
      const month = dateMatch ? months.indexOf(dateMatch[1].toLowerCase()) : -1
      const date =
        dateMatch && month >= 0
          ? `${dateMatch[3]}-${String(month + 1).padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`
          : null
      const validDate =
        date && new Date(date).toISOString().slice(0, 10) === date ? date : null
      const noCharge =
        /\b(?:you (?:will not|won['’]t) be charged|no (?:further|future|upcoming) charges)\b/i.test(
          next,
        )
      const canceled =
        /\b(?:cancelled|canceled|cancellation scheduled)\b/i.test(next)
      const billingRoot = one('[data-testid="billing-container"]')
      const blocked =
        !matched ||
        !billingRoot ||
        !!document.querySelector('input[type="password"]')
      const dialogs = Array.from(
        document.querySelectorAll('[role="dialog"]'),
      ).filter(visible)
      const dialog = dialogs.length === 1 ? dialogs[0] : null
      const text = norm(dialog?.textContent ?? null)
      const benefits =
        !!dialog &&
        !!one(
          '[data-testid="cancel-subscrition-dialog__confirm-page-text"]',
          dialog,
        ) &&
        /you can enjoy all business plan benefits until the trial ends/i.test(
          text,
        ) &&
        /your account will expire at the end of the trial period/i.test(text)
      const offer =
        !!dialog &&
        !!one(
          '[data-testid="cancel-subscription-dialog__extend-trial-body"]',
          dialog,
        ) &&
        /get an extra 14 days on the business plan trial/i.test(text) &&
        /keep exploring advanced features for free/i.test(text)
      const choice =
        !!dialog &&
        !!one(
          'label[data-testid="cancel-subscription-dialog__cancel-radio"]',
          dialog,
        ) &&
        !!one(
          'label[data-testid="cancel-subscription-dialog__downgrade-radio"]',
          dialog,
        )
      const reason =
        !!dialog &&
        !!one(
          'textarea[data-testid="open-format-feedback__textarea"]',
          dialog,
        ) &&
        !!one(
          'button[data-testid="open-format-feedback__submit-btn"]',
          dialog,
        ) &&
        /cancel|reason|leav/i.test(text)
      const reasonInput = reason
        ? (one(
            'textarea[data-testid="open-format-feedback__textarea"]',
            dialog!,
          ) as HTMLTextAreaElement)
        : null
      const reasonEmpty = reasonInput?.value === "",
        reasonReady = reasonInput?.value === neutral
      const cancelLabel = choice
        ? one(
            'label[data-testid="cancel-subscription-dialog__cancel-radio"]',
            dialog!,
          )
        : null
      const cancelRadio = cancelLabel?.querySelector(
        'input[type="radio"]',
      ) as HTMLInputElement | null
      const downgradeRadio = dialog?.querySelector(
        'label[data-testid="cancel-subscription-dialog__downgrade-radio"] input[type="radio"]',
      ) as HTMLInputElement | null
      const cancelSelected =
        !!cancelRadio?.checked &&
        !cancelRadio.disabled &&
        downgradeRadio?.checked === false
      const unsafeTerms =
        /\b(?:cancellation fee|early termination fee|charged a fee|payment required|effective immediately|lose access immediately|delete (?:your )?account)\b/i.test(
          text,
        )
      const targets: Array<{
        stage: MiroDOMStage
        label: string
        x: number
        y: number
        count: number
        hit: boolean
      }> = []
      const add = (
        stage: MiroDOMStage,
        selector: string,
        labels: string[],
        root: ParentNode,
      ) => {
        const elements = Array.from(root.querySelectorAll(selector)).filter(
          (n) =>
            visible(n) &&
            labels.includes(norm(n.textContent)) &&
            !(n as HTMLButtonElement).disabled,
        )
        if (elements.length !== 1) return
        const n = elements[0]
        if (scrollTarget)
          n.scrollIntoView({
            block: "center",
            inline: "center",
            behavior: "instant",
          })
        const r = n.getBoundingClientRect(),
          x = Math.round(r.x + r.width / 2),
          y = Math.round(r.y + r.height / 2)
        targets.push({
          stage,
          label: labels.find((l) => l === norm(n.textContent))!,
          x,
          y,
          count: elements.length,
          hit:
            x >= 0 &&
            y >= 0 &&
            x < innerWidth &&
            y < innerHeight &&
            n.contains(document.elementFromPoint(x, y)),
        })
      }
      if (!blocked && !unsafeTerms && dialogs.length <= 1) {
        if (!dialog && trial)
          add(
            "ENTRY",
            '[data-testid="settings__billing-overview__cancel-subscription-section"] button',
            ["Cancel trial"],
            billingRoot!,
          )
        if (benefits)
          add(
            "BENEFITS",
            'button[data-testid="cancel-subscription-dialog__submit-btn"]',
            ["Continue"],
            dialog!,
          )
        if (offer)
          add(
            "DECLINE_OFFER",
            'button[data-testid="cancel-subscription-dialog__extend-trial-cancel-btn"]',
            ["Continue to cancel"],
            dialog!,
          )
        if (
          choice &&
          cancelLabel &&
          /\bCancel trial\b/.test(norm(cancelLabel.textContent))
        ) {
          if (!cancelSelected)
            add(
              "CANCEL_CHOICE",
              'label[data-testid="cancel-subscription-dialog__cancel-radio"]',
              ["Cancel trial"],
              dialog!,
            )
          else
            add(
              "REASON_NEXT",
              'button[data-testid="cancel-subscription-dialog__confirm-btn"]',
              ["Cancel subscription"],
              dialog!,
            )
        }
        if (reasonReady)
          add(
            "FINAL",
            'button[data-testid="open-format-feedback__submit-btn"]',
            ["Cancel subscription", "Cancel trial"],
            dialog!,
          )
      }
      const surfaceBytes = new TextEncoder().encode(
        JSON.stringify({ next, plan, text }),
      )
      const surfaceHash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", surfaceBytes)),
      )
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("")
      return {
        surfaceHash,
        matched,
        authenticated: !blocked,
        trial,
        interval,
        currency: amountMatch ? "USD" : null,
        amount,
        accessUntil: validDate,
        noCharge,
        canceled,
        dialog: dialogs.length > 0,
        ambiguous: dialogs.length > 1,
        benefits,
        offer,
        choice,
        reason,
        reasonEmpty,
        reasonReady,
        cancelSelected,
        unsafeTerms,
        targets,
        width: innerWidth,
        height: innerHeight,
      }
    },
    { expectedUrl, scrollTarget, neutral: DOM_NEUTRAL_REASON },
  )
  return {
    ...facts,
    evidenceHash: createHash("sha256")
      .update(JSON.stringify(facts))
      .digest("hex"),
  }
}
export type MiroTrialDOM = Awaited<ReturnType<typeof readMiroTrialDOM>>

// A bounded deterministic state machine, not a free-text planner. Only observed
// narrow Miro trial surfaces can advance. No default button and no write retries.
export function nextMiroDOMStage(
  f: MiroTrialDOM,
  history: readonly MiroDOMStage[],
): MiroDOMStage | null {
  if (
    !f.matched ||
    !f.authenticated ||
    !f.trial ||
    f.unsafeTerms ||
    f.ambiguous
  )
    return null
  if (!history.length)
    return !f.dialog && f.targets.some((t) => t.stage === "ENTRY")
      ? "ENTRY"
      : null
  const last = history.at(-1)
  if (last === "ENTRY" && f.benefits) return "BENEFITS"
  if (last === "BENEFITS" && f.offer) return "DECLINE_OFFER"
  if (
    (last === "DECLINE_OFFER" || last === "BENEFITS") &&
    f.choice &&
    !f.cancelSelected
  )
    return "CANCEL_CHOICE"
  if (last === "CANCEL_CHOICE" && f.choice && f.cancelSelected)
    return "REASON_NEXT"
  if (last === "REASON_NEXT" && f.reason && f.reasonEmpty) return "REASON_INPUT"
  if (
    last === "REASON_INPUT" &&
    f.reason &&
    f.reasonReady &&
    f.targets.some((t) => t.stage === "FINAL")
  )
    return "FINAL"
  return null
}
