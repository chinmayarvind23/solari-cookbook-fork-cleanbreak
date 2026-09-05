import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import sharp from "sharp"
import { describe, it, expect, vi } from "vitest"
import type { Desktop } from "@solarisdk/desktop"
import { readDesktopConfig, realProviderExecutor } from "@/lib/desktop/config"
import {
  desktopDecisionSchema,
  desktopPolicy,
  NEUTRAL_REASON,
  SAFE_DESKTOP_NAVIGATION_KEYS,
  safeDesktopDecision,
  authorizeDesktopNavigation,
  evaluateDesktopDecision,
  type DesktopDecision,
} from "@/lib/desktop/decision"
import type { MiroScope } from "@/lib/desktop/miro"
import {
  createDesktopPlanner,
  DesktopPlanningFailure,
} from "@/lib/desktop/planner"
import {
  runDesktopDryRun,
  executeNavigation,
  type DesktopHandle,
} from "@/lib/desktop/runtime"
import {
  desktopEvidence,
  successfulDesktopValidation,
} from "@/lib/desktop/evidence"
import { startDesktopViewer } from "@/lib/desktop/viewer"
import { desktopDryRunCommand } from "@/scripts/real-provider-desktop-dry-run"

vi.mock("@/lib/desktop/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktop/session")>()),
  readDesktopSessionState: vi.fn(() => undefined),
}))

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  SOLARI_API_KEY: "private-api-sentinel",
  OPENAI_API_KEY: "private-openai-sentinel",
  SOLARI_DESKTOP_SESSION_ID: "pool:vm:org.private-session-sentinel",
  CLEANBREAK_REAL_PROVIDER_EXECUTOR: "desktop",
  CLEANBREAK_DRY_RUN: "true",
  CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "true",
  CLEANBREAK_REAL_PROVIDER_NAME: "Test Provider",
  CLEANBREAK_REAL_PROVIDER_PLAN_NAME: "Test trial",
  CLEANBREAK_REAL_PROVIDER_URL: "https://provider.example/billing",
  CLEANBREAK_REAL_PROVIDER_AMOUNT_CENTS: "100",
  CLEANBREAK_REAL_PROVIDER_CURRENCY: "USD",
  CLEANBREAK_REAL_PROVIDER_INTERVAL: "MONTHLY",
}
function decision(patch: Partial<DesktopDecision> = {}): DesktopDecision {
  return {
    type: "final_cancel_candidate",
    x: 200,
    y: 300,
    text: null,
    keys: null,
    deltaY: null,
    scrollbar: null,
    targetText: "Confirm cancellation",
    visibleText: "No fee",
    observedOrigin: "https://provider.example",
    miroObservation: null,
    destinationOrigin: null,
    pageStatus: "authenticated_provider",
    flowStage: "BILLING",
    reasoning: "Stop before cancellation",
    confidence: 0.99,
    reason: null,
    ...patch,
  }
}
const baseScreenshot = await sharp({
  create: { width: 1280, height: 720, channels: 4, background: "white" },
})
  .png()
  .toBuffer()
const png = () => Buffer.from(baseScreenshot)

describe("narrow Miro cancellation adapter", () => {
  const url = "https://miro.com/app/settings/company/test-company/billing"
  const scope: MiroScope = {
    providerName: "Miro",
    startUrl: url,
    completedCancellationSteps: 0,
    completedRules: [],
  }
  const entered: MiroScope = {
    ...scope,
    completedCancellationSteps: 1,
    completedRules: ["ENTRY"],
  }
  const miroEnv = {
    ...env,
    CLEANBREAK_REAL_PROVIDER_NAME: "Miro",
    CLEANBREAK_REAL_PROVIDER_URL: url,
  }
  function miro(
    label = "Cancel subscription",
    surface: NonNullable<
      DesktopDecision["miroObservation"]
    >["surface"] = "BILLING_PAGE",
    context = "Billing actions",
    role: NonNullable<
      DesktopDecision["miroObservation"]
    >["targetRole"] = "BUTTON",
  ) {
    return decision({
      targetText: label,
      visibleText: context,
      observedOrigin: "https://miro.com",
      miroObservation: {
        pageUrl: url,
        surface,
        targetRole: role,
        targetContext: context,
      },
    })
  }
  const assess = (d: DesktopDecision, s = scope) =>
    evaluateDesktopDecision(d, "https://miro.com", 1280, 720, 0.9, s)
  const loading = () =>
    decision({
      type: "wait",
      pageStatus: "loading",
      observedOrigin: "https://miro.com",
      x: null,
      y: null,
      targetText: null,
      visibleText: "Loading spinner",
      flowStage: "CANCELLATION_ENTRY",
    })
  it("waits through the observed Miro loading overlay without repeating entry, then reaches the final boundary", async () => {
    const h = harness([
      miro(),
      loading(),
      loading(),
      miro("Continue", "CANCELLATION_DIALOG", "Cancel subscription"),
      miro(
        "Cancel trial",
        "FINAL_CONFIRMATION",
        "Cancellation will be scheduled",
      ),
    ])
    const run = await runDesktopDryRun(miroEnv, { ...h.deps, auto: true })
    expect(
      run.steps.filter((s) => s.execution === "OBSERVATION_ONLY"),
    ).toHaveLength(2)
    expect(h.vm.mouse.click).toHaveBeenCalledTimes(2)
    expect(h.vm.keyboard.type).not.toHaveBeenCalled()
    expect(run.finalBoundaryEstablished).toBe(true)
    expect(successfulDesktopValidation(run)).toBe(true)
    expect(run.destructiveClicksExecuted).toBe(0)
    expect(run.automaticDestructiveRetries).toBe(0)
    expect(h.vm.pause).not.toHaveBeenCalled()
  })
  it("times out endless loading without repeating the click", async () => {
    const h = harness([miro(), ...Array.from({ length: 6 }, loading)])
    const run = await runDesktopDryRun(miroEnv, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("PROVIDER_LOADING_TIMEOUT")
    expect(h.vm.mouse.click).toHaveBeenCalledTimes(1)
    expect(h.vm.close).toHaveBeenCalled()
    expect(successfulDesktopValidation(run)).toBe(false)
  })
  it.each([
    { pageStatus: "challenge" },
    { pageStatus: "login" },
    { observedOrigin: "https://other.example" },
    { x: 200 },
    { text: "arbitrary" },
  ] satisfies Partial<DesktopDecision>[])(
    "rejects unsafe wait %j without dispatch",
    async (patch) => {
      const h = harness([miro(), { ...loading(), ...patch }])
      const run = await runDesktopDryRun(miroEnv, { ...h.deps, auto: true })
      expect(run.stopReason).toBe("INVALID_LOADING_OBSERVATION")
      expect(h.vm.mouse.click).toHaveBeenCalledTimes(1)
      expect(
        authorizeDesktopNavigation(
          loading(),
          "https://miro.com",
          1280,
          720,
          0.9,
          entered,
        ),
      ).toBeNull()
    },
  )
  function billingTrial() {
    const d = miro(
      "Cancel trial",
      "BILLING_PAGE",
      "Plan details Upgrade Billing actions Change payment method Licensing configuration Cancel trial",
    )
    d.miroObservation!.targetContext = "Licensing configuration Cancel trial"
    d.miroObservation!.pageUrl = `${url}/`
    return d
  }
  const trialBenefitsCopy =
    "You can enjoy all Business Plan benefits until the trial ends on September 30, 2026, but won't be able to add new Members. Your account will expire at the end of the trial period. Here's what you'll lose: Unlimited private workspaces. Keep Business Plan Continue"
  function trialBenefits() {
    const d = miro("Continue", "CANCELLATION_DIALOG", trialBenefitsCopy)
    d.flowStage = "RETENTION"
    return d
  }
  it("recognizes the observed scrolled trial-benefits Continue without a visible cancel heading", () => {
    expect(trialBenefitsCopy.toLowerCase()).not.toContain("cancel")
    const assessment = assess(trialBenefits(), entered)
    expect(assessment).toMatchObject({
      diagnostic: "MIRO_CONTINUE_TRIAL_BENEFITS",
      rule: "CONTINUE_DIALOG",
      decision: { type: "cancel_flow_navigation", flowStage: "RETENTION" },
      policy: { result: "ALLOW" },
      finalBoundaryEstablished: false,
    })
  })
  it("recognizes wrapped visible text without inventing the clipped heading", () => {
    const d = trialBenefits()
    d.visibleText = "Continue"
    d.miroObservation!.targetContext = trialBenefitsCopy.replaceAll(" ", "\n")
    expect(assess(d, entered).diagnostic).toBe("MIRO_CONTINUE_TRIAL_BENEFITS")
  })
  it.each([
    "you can enjoy all business plan benefits until the trial ends",
    "your account will expire at the end of the trial period",
    "keep business plan",
  ])(
    "requires the complete visible trial-benefits signature: %s",
    (missing) => {
      const d = trialBenefits()
      const reduced = trialBenefitsCopy.toLowerCase().replace(missing, "")
      d.visibleText = reduced
      d.miroObservation!.targetContext = reduced
      expect(assess(d, entered).policy.result).toBe("INTERCEPT")
    },
  )
  it("does not import entry history from another job or repeat this Continue", () => {
    expect(assess(trialBenefits()).diagnostic).toBe(
      "MIRO_ENTRY_CONTEXT_NOT_ESTABLISHED",
    )
    for (const completedRules of [
      [],
      ["CONTINUE_DIALOG"],
      ["ENTRY", "CONTINUE_DIALOG"],
      ["ENTRY", "CANCEL_CHOICE"],
    ] as MiroScope["completedRules"][]) {
      expect(
        assess(trialBenefits(), { ...entered, completedRules }).policy.result,
      ).toBe("INTERCEPT")
    }
    expect(
      assess(trialBenefits(), { ...entered, completedCancellationSteps: 2 })
        .policy.result,
    ).toBe("INTERCEPT")
  })
  it.each([
    "cancellation will be scheduled",
    "clicking Continue cancels your trial now",
    "cancellation fee",
    "unpaid invoice",
    "downgrade",
    "agree to terms",
    "payment change",
  ])("never overrides %s with the benefits-dialog exception", (warning) => {
    for (const local of [true, false]) {
      const d = trialBenefits()
      if (local) d.miroObservation!.targetContext += ` ${warning}`
      else d.visibleText += ` ${warning}`
      expect(assess(d, entered).policy.result).toBe("INTERCEPT")
    }
  })
  it.each([
    { confidence: 0.94 },
    { pageStatus: "login" },
    { pageStatus: "challenge" },
    { observedOrigin: "https://other.example" },
    { x: null },
    { targetText: "Cancel trial" },
    { targetText: "Confirm cancellation" },
    { targetText: "Keep Business Plan" },
  ] as Partial<DesktopDecision>[])(
    "keeps unsafe/mismatched trial observations closed %#",
    (patch) => {
      expect(
        assess({ ...trialBenefits(), ...patch }, entered).policy.result,
      ).not.toBe("ALLOW")
    },
  )
  it.each([
    "BILLING_PAGE",
    "FINAL_CONFIRMATION",
    "REASON",
    "CANCELLATION_CHOICE",
  ] as const)("does not apply the trial-benefits Continue to %s", (surface) => {
    const d = trialBenefits()
    d.miroObservation!.surface = surface
    expect(assess(d, entered).policy.result).toBe("INTERCEPT")
  })
  it("keeps generic Continue policy unchanged", () => {
    const d = trialBenefits()
    d.type = "click"
    expect(desktopPolicy(d, "https://miro.com", 1280, 720, 0.9).result).toBe(
      "INTERCEPT",
    )
    expect(assess(d, { ...entered, providerName: "Other" }).policy.result).toBe(
      "INTERCEPT",
    )
  })
  it("traverses the clipped-heading regression and the documented synthetic later steps to the final boundary", async () => {
    const reason = miro(
      "No longer needed",
      "REASON",
      "Cancellation reason",
      "RADIO",
    )
    reason.type = "click"
    reason.flowStage = "REASON"
    const h = harness([
      billingTrial(),
      scrollbarDecision({
        observedOrigin: "https://miro.com",
        flowStage: "RETENTION",
      }),
      trialBenefits(),
      miro(
        "Cancel trial",
        "CANCELLATION_CHOICE",
        "Choose Cancel trial before the Cancel subscription button",
        "RADIO",
      ),
      miro(
        "Cancel subscription",
        "CANCELLATION_CHOICE",
        "Opens the cancellation reason screen",
      ),
      reason,
      miro(
        "Cancel trial",
        "FINAL_CONFIRMATION",
        "Cancellation will be scheduled",
      ),
    ])
    const run = await runDesktopDryRun(miroEnv, { ...h.deps, auto: true })
    expect(run.steps[2]).toMatchObject({
      adapterDiagnostic: "MIRO_CONTINUE_TRIAL_BENEFITS",
      execution: "NAVIGATION_RETURNED",
    })
    expect(run).toMatchObject({
      state: "AWAITING_APPROVAL",
      stopReason: "FINAL_ACTION_BOUNDARY",
      finalBoundaryEstablished: true,
      destructiveClicksExecuted: 0,
      unsafeActionsExecuted: 0,
      automaticDestructiveRetries: 0,
    })
    expect(successfulDesktopValidation(run)).toBe(true)
    expect(h.vm.mouse.drag).toHaveBeenCalledOnce()
    expect(h.vm.mouse.click).toHaveBeenCalledTimes(5)
    expect(run.steps.at(-1)?.execution).toBe("NOT_EXECUTED")
    expect(JSON.stringify(run)).not.toContain(trialBenefitsCopy)
    expect(h.deps.confirm).not.toHaveBeenCalled()
  })
  it("does not retry the trial dialog Continue after an uncertain input", async () => {
    const h = harness([billingTrial(), trialBenefits()])
    h.vm.mouse.click
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("private failure"))
    const run = await runDesktopDryRun(miroEnv, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY")
    expect(h.vm.mouse.click).toHaveBeenCalledTimes(2)
    expect(run.automaticDestructiveRetries).toBe(0)
    expect(JSON.stringify(run)).not.toContain("private failure")
  })
  it("allows standalone trial entry despite unrelated Upgrade/payment controls and a trailing slash", () => {
    expect(assess(billingTrial())).toMatchObject({
      rule: "ENTRY",
      diagnostic: "MIRO_ENTRY",
      policy: { result: "ALLOW" },
    })
    const d = billingTrial()
    d.miroObservation!.pageUrl = url
    expect(assess(d, { ...scope, startUrl: `${url}/` }).rule).toBe("ENTRY")
  })
  it.each([null, "", "Cancel trial payment change", "Cancel trial upgrade"])(
    "fails closed for missing or risky target context %s",
    (context) => {
      const d = billingTrial()
      d.miroObservation!.targetContext = context
      expect(assess(d).policy.result).toBe("INTERCEPT")
    },
  )
  it("does not hide consequences in either page or local target context", () => {
    for (const local of [true, false]) {
      const d = billingTrial()
      if (local)
        d.miroObservation!.targetContext += " Cancellation will be scheduled"
      else d.visibleText += " Cancellation will be scheduled"
      expect(assess(d)).toMatchObject({
        policy: { result: "INTERCEPT" },
        diagnostic: "MIRO_FINAL_OR_CONSEQUENCE_CONTEXT",
        finalBoundaryEstablished: false,
      })
    }
  })
  it("traverses the live-shaped trial entry and stops at a later final boundary offline", async () => {
    const h = harness([
      billingTrial(),
      miro("Continue", "CANCELLATION_DIALOG", "Cancel trial"),
      miro(
        "Cancel trial",
        "FINAL_CONFIRMATION",
        "Cancellation will be scheduled",
      ),
    ])
    const run = await runDesktopDryRun(miroEnv, { ...h.deps, auto: true })
    expect(h.vm.mouse.click).toHaveBeenCalledTimes(2)
    expect(run.steps[0]).toMatchObject({
      adapterRule: "ENTRY",
      adapterDiagnostic: "MIRO_ENTRY",
      execution: "NAVIGATION_RETURNED",
    })
    expect(run.steps.at(-1)?.execution).toBe("NOT_EXECUTED")
    expect(successfulDesktopValidation(run)).toBe(true)
    expect(run).toMatchObject({
      finalBoundaryEstablished: true,
      paused: false,
      controlClosed: true,
      destructiveClicksExecuted: 0,
      unsafeActionsExecuted: 0,
      automaticDestructiveRetries: 0,
    })
    expect(JSON.stringify(run)).not.toContain("Change payment method")
    expect(JSON.stringify(run)).not.toContain(url)
  })
  it.each(["Cancel subscription", "Cancel trial"])(
    "allows first documented %s Billing entry",
    (label) => {
      expect(
        assess(
          miro(
            label,
            "BILLING_PAGE",
            "Billing actions Licensing configuration Trial",
          ),
        ),
      ).toMatchObject({
        rule: "ENTRY",
        policy: { result: "ALLOW" },
        decision: {
          type: "cancel_flow_navigation",
          flowStage: "CANCELLATION_ENTRY",
        },
        finalBoundaryEstablished: false,
      })
    },
  )
  it("does not reuse the entry exception after completed navigation", () => {
    expect(assess(miro(), entered).policy.result).toBe("INTERCEPT")
    expect(
      assess(
        miro(
          "Cancel subscription",
          "CANCELLATION_CHOICE",
          "Choose cancellation",
        ),
        entered,
      ).policy.result,
    ).toBe("INTERCEPT")
  })
  it.each([
    "Confirm cancellation",
    "Cancel now",
    "End trial",
    "Yes, cancel",
    "Complete cancellation",
    "Cancel subscription",
    "Cancel trial",
  ])("intercepts final %s", (label) => {
    const d = miro(
      label,
      "FINAL_CONFIRMATION",
      "Cancellation will be scheduled and effective at period end",
    )
    expect(assess(d, entered)).toMatchObject({
      policy: { result: "INTERCEPT" },
      finalBoundaryEstablished: true,
    })
    expect(
      authorizeDesktopNavigation(
        d,
        "https://miro.com",
        1280,
        720,
        0.9,
        entered,
      ),
    ).toBeNull()
  })
  it.each([
    "scheduled",
    "cancels your subscription now",
    "clicking cancels the subscription",
    "immediately",
    "effective",
    "confirmed",
    "will be canceled",
    "will end",
    "unpaid invoice",
    "downgrade",
    "upgrade",
    "pause",
    "payment",
    "agree to terms",
  ])("does not allow entry with %s consequences", (context) => {
    expect(
      assess(
        miro(
          "Cancel subscription",
          "BILLING_PAGE",
          `Billing actions ${context}`,
        ),
      ).policy.result,
    ).toBe("INTERCEPT")
  })
  it.each([
    { pageStatus: "login" },
    { pageStatus: "challenge" },
    { pageStatus: "unknown" },
    { confidence: 0.1 },
    { x: -1 },
    { observedOrigin: "https://other.example" },
    { destinationOrigin: "https://other.example" },
    { miroObservation: null },
  ] satisfies Partial<DesktopDecision>[])(
    "fails closed on missing/unsafe observation %j",
    (patch) => {
      expect(assess({ ...miro(), ...patch }).policy.result).not.toBe("ALLOW")
    },
  )
  it.each([
    "https://miro.com/app/settings/company/other/billing",
    "https://other.example/billing",
    `${url}?private=value`,
    "https://miro.com/.../billing",
  ])("rejects mismatched/truncated URL %s", (pageUrl) => {
    const d = miro()
    d.miroObservation!.pageUrl = pageUrl
    expect(assess(d).policy.result).toBe("INTERCEPT")
  })
  it("leaves the generic non-Miro ambiguous cancel policy intercepted", () => {
    expect(
      assess(miro(), { ...scope, providerName: "Other" }).policy.result,
    ).toBe("INTERCEPT")
    expect(
      desktopPolicy(miro(), "https://miro.com", 1280, 720, 0.9).result,
    ).toBe("INTERCEPT")
  })
  it("requires a standalone billing surface and trial context", () => {
    expect(
      assess(miro("Cancel subscription", "CANCELLATION_DIALOG")).policy.result,
    ).toBe("INTERCEPT")
    expect(assess(miro("Cancel trial")).policy.result).toBe("INTERCEPT")
    expect(
      assess(miro("Cancel subscription", "BILLING_PAGE", "Unknown page")).policy
        .result,
    ).toBe("INTERCEPT")
  })
  it("allows only a non-committing choice or explicit next-review button", () => {
    const context = "Choose Cancel subscription before the Continue button"
    expect(
      assess(
        miro("Cancel subscription", "CANCELLATION_CHOICE", context, "RADIO"),
        entered,
      ).rule,
    ).toBe("CANCEL_CHOICE")
    expect(
      assess(
        miro("Cancel subscription", "CANCELLATION_CHOICE", context),
        entered,
      ).policy.result,
    ).toBe("INTERCEPT")
    expect(
      assess(
        miro(
          "Cancel subscription",
          "CANCELLATION_CHOICE",
          "Opens the cancellation reason screen",
        ),
        entered,
      ).rule,
    ).toBe("NEXT_REVIEW")
  })
  it.each(["Continue", "Continue to cancel"])(
    "allows documented %s but not retention acceptance",
    (label) => {
      expect(
        assess(
          miro(label, "CANCELLATION_DIALOG", "Cancel subscription"),
          entered,
        ).rule,
      ).toBe("CONTINUE_DIALOG")
      expect(
        assess(miro(label, "REASON", "Cancellation reason"), entered).rule,
      ).toBe("CONTINUE_REASON")
      expect(
        assess(
          miro(
            label,
            "CANCELLATION_DIALOG",
            "Cancel subscription and downgrade",
          ),
          entered,
        ).policy.result,
      ).toBe("INTERCEPT")
      expect(
        assess(miro(label, "CANCELLATION_DIALOG", "Cancel subscription"), {
          ...entered,
          completedRules: ["ENTRY", "CONTINUE_DIALOG"],
        }).policy.result,
      ).toBe("INTERCEPT")
    },
  )
  it("limits optional tool choice to neutral non-financial selection", () => {
    expect(
      assess(
        miro(
          "Prefer not to say",
          "TOOL_SWITCH",
          "Switching to another tool",
          "OPTION",
        ),
        entered,
      ).rule,
    ).toBe("NEUTRAL_TOOL_CHOICE")
    expect(
      assess(miro("Upgrade", "TOOL_SWITCH", "Switch tool", "OPTION"), entered)
        .policy.result,
    ).not.toBe("ALLOW")
  })
  it("keeps URL and private context out of safe decision evidence", () => {
    const safe = JSON.stringify(
      safeDesktopDecision(
        miro("Cancel subscription", "BILLING_PAGE", "private-screen-sentinel"),
      ),
    )
    expect(safe).not.toContain(url)
    expect(safe).not.toContain("private-screen-sentinel")
  })
  it("traverses documented reversible steps once and validates only the later final boundary", async () => {
    const reason = miro("No longer needed", "REASON", "Cancellation reason")
    reason.type = "click"
    reason.flowStage = "REASON"
    const h = harness([
      miro(),
      miro("Continue to cancel", "CANCELLATION_DIALOG", "Cancel subscription"),
      miro(
        "Cancel subscription",
        "CANCELLATION_CHOICE",
        "Choose Cancel subscription before the Continue button",
        "RADIO",
      ),
      miro(
        "Cancel subscription",
        "CANCELLATION_CHOICE",
        "Opens the cancellation reason screen",
      ),
      reason,
      miro("Continue to cancel", "REASON", "Cancellation reason"),
      miro(
        "Cancel subscription",
        "FINAL_CONFIRMATION",
        "Cancellation will be scheduled",
      ),
    ])
    const run = await runDesktopDryRun(miroEnv, { ...h.deps, auto: true })
    expect(run).toMatchObject({
      providerAdapter: "miro",
      state: "AWAITING_APPROVAL",
      finalBoundaryEstablished: true,
      stopReason: "FINAL_ACTION_BOUNDARY",
      destructiveClicksExecuted: 0,
      unsafeActionsExecuted: 0,
      automaticDestructiveRetries: 0,
    })
    expect(h.vm.mouse.click).toHaveBeenCalledTimes(6)
    expect(run.steps[0]).toMatchObject({
      adapterRule: "ENTRY",
      flowStage: "CANCELLATION_ENTRY",
      execution: "NAVIGATION_RETURNED",
    })
    expect(run.steps.at(-1)?.execution).toBe("NOT_EXECUTED")
    expect(successfulDesktopValidation(run)).toBe(true)
    expect(
      successfulDesktopValidation({ ...run, finalBoundaryEstablished: false }),
    ).toBe(false)
    expect(
      successfulDesktopValidation({ ...run, steps: run.steps.slice(-1) }),
    ).toBe(false)
    expect(JSON.stringify(run)).not.toContain(url)
  })
  it("auto stops on repeated ambiguous labels without validation or destructive retries", async () => {
    const h = harness([miro(), miro()])
    const run = await runDesktopDryRun(miroEnv, { ...h.deps, auto: true })
    expect(h.vm.mouse.click).toHaveBeenCalledTimes(1)
    expect(run.finalBoundaryEstablished).toBe(false)
    expect(successfulDesktopValidation(run)).toBe(false)
    expect(run.automaticDestructiveRetries).toBe(0)
  })
  it("retains human review, screenshot stability, and no retry on failed entry", async () => {
    const denied = harness([miro()])
    denied.deps.confirm.mockResolvedValue(false)
    await runDesktopDryRun(miroEnv, denied.deps)
    expect(denied.vm.mouse.click).not.toHaveBeenCalled()
    const changed = harness([miro()])
    changed.vm.screenshot
      .mockResolvedValueOnce(png())
      .mockResolvedValue(await drift(200, 300))
    expect((await runDesktopDryRun(miroEnv, changed.deps)).stopReason).toBe(
      "SCREEN_CHANGED",
    )
    expect(changed.vm.mouse.click).not.toHaveBeenCalled()
    const failed = harness([miro()])
    failed.vm.mouse.click.mockRejectedValue(new Error("failed"))
    const run = await runDesktopDryRun(miroEnv, { ...failed.deps, auto: true })
    expect(failed.vm.mouse.click).toHaveBeenCalledTimes(1)
    expect(successfulDesktopValidation(run)).toBe(false)
    expect(run.steps).toHaveLength(1)
  })
})

async function drift(left = 10, top = 10) {
  const cursor = await sharp({
    create: { width: 2, height: 20, channels: 4, background: "black" },
  })
    .png()
    .toBuffer()
  return sharp(png())
    .composite([{ input: cursor, left, top }])
    .png()
    .toBuffer()
}
function harness(decisions = [decision()]) {
  const vm = {
    connect: vi.fn(async () => undefined),
    health: vi.fn(async () => ({ ready: true })),
    screenshot: vi.fn(async () => png()),
    display: { size: vi.fn(async () => ({ w: 1280, h: 720 })) },
    mouse: {
      click: vi.fn(async () => undefined),
      drag: vi.fn(
        async (
          _from: { x: number; y: number },
          _to: { x: number; y: number },
        ) => undefined,
      ),
    },
    keyboard: {
      type: vi.fn(async () => undefined),
      press: vi.fn(async () => undefined),
    },
    stream: {
      start: vi.fn(async () => ({
        streamUrl: "wss://solari.example/private-stream-sentinel",
      })),
    },
    record: {
      start: vi.fn(async () => ({ path: "/tmp/record.mp4", fps: 10 })),
      stop: vi.fn(async () => ({ path: "/tmp/record.mp4", sizeBytes: 100 })),
    },
    downloadUrl: vi.fn(async () => ({
      url: "https://solari.example/record?token=private-recording-sentinel",
    })),
    pause: vi.fn(async () => undefined),
    close: vi.fn(),
    destroy: vi.fn(),
  }
  const client = {
    connect: vi.fn(async (_id: string) => vm as unknown as Desktop),
    pause: vi.fn(async () => ({
      sessionId: "test",
      status: "paused" as const,
    })),
  }
  let next = 0
  const planner = vi.fn(
    async (_input: Parameters<ReturnType<typeof createDesktopPlanner>>[0]) => ({
      decision: decisions[Math.min(next++, decisions.length - 1)],
      tokens: 100,
    }),
  )
  const viewer = {
    url: "http://127.0.0.1:12345/local-only/",
    setRecording: vi.fn(),
    close: vi.fn(async () => undefined),
  }
  const evidence = {
    directory: "offline",
    screenshot: vi.fn((step: number, _bytes: Uint8Array) => `step-${step}.png`),
    job: vi.fn(),
    validation: vi.fn(() => true),
  }
  const deps = {
    id: "test-desktop-run",
    client,
    planner,
    evidence,
    viewer: vi.fn(async () => viewer),
    prepare: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
    reviewRecording: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
  }
  return { vm, client, planner, evidence, viewer, deps }
}

function scrollbarDecision(patch: Partial<DesktopDecision> = {}) {
  return decision({
    type: "scroll",
    x: 1052,
    y: 300,
    deltaY: 120,
    targetText: "vertical scrollbar",
    visibleText: null,
    scrollbar: {
      left: 1046,
      top: 180,
      width: 12,
      height: 520,
      thumbTop: 190,
      thumbHeight: 300,
    },
    ...patch,
  })
}

describe("visible scrollbar-only navigation", () => {
  const grant = (d: DesktopDecision) =>
    authorizeDesktopNavigation(d, "https://provider.example", 1280, 720, 0.9)
  it("dispatches only an immutable one-use scrollbar grant with exact SDK drag arguments", async () => {
    const h = harness()
    const raw = scrollbarDecision()
    expect(await executeNavigation(h.vm as unknown as DesktopHandle, raw)).toBe(
      "ACTION_NOT_DISPATCHED",
    )
    const allowed = grant(raw)!
    expect(Object.isFrozen(allowed.scrollbar)).toBe(true)
    raw.scrollbar!.left = 1
    expect(allowed.scrollbar!.left).toBe(1046)
    expect(
      await executeNavigation(h.vm as unknown as DesktopHandle, allowed),
    ).toBe("NAVIGATION_RETURNED")
    expect(
      await executeNavigation(h.vm as unknown as DesktopHandle, allowed),
    ).toBe("ACTION_NOT_DISPATCHED")
    expect(h.vm.mouse.drag).toHaveBeenCalledExactlyOnceWith(
      { x: 1052, y: 300 },
      { x: 1052, y: 420 },
    )
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    expect(h.vm.keyboard.press).not.toHaveBeenCalled()
  })
  it.each([
    { scrollbar: null },
    { targetText: "slider" },
    { targetText: "Confirm cancellation" },
    { confidence: 0.94 },
    { deltaY: 0 },
    { deltaY: 161 },
    { deltaY: -120 }, // thumb would move outside the track
    { x: 1020 },
    { y: 600 }, // in track, not in the thumb
    { text: "arbitrary" },
    { keys: ["Enter"] },
    { pageStatus: "unknown" },
    { observedOrigin: "https://other.example" },
    { destinationOrigin: "https://provider.example" },
  ] as Partial<DesktopDecision>[])(
    "refuses unestablished/arbitrary drag %#",
    (patch) => {
      expect(grant(scrollbarDecision(patch))).toBeNull()
    },
  )
  it.each([
    { width: 40 },
    { top: 50 },
    { height: 40 },
    { left: 1280 },
    { thumbHeight: 4 },
    { thumbTop: 170 },
    { height: 1000 },
    { thumbHeight: 520 },
  ])("refuses invalid or browser-chrome geometry %j", (patch) => {
    const d = scrollbarDecision()
    d.scrollbar = { ...d.scrollbar!, ...patch }
    expect(grant(d)).toBeNull()
  })
  it.each([300, 360, 420])(
    "guards the entire drag corridor at y=%s before dispatch",
    async (top) => {
      const h = harness([scrollbarDecision()])
      h.vm.screenshot
        .mockResolvedValueOnce(png())
        .mockResolvedValue(await drift(1052, top))
      const run = await runDesktopDryRun(env, h.deps)
      expect(run.stopReason).toBe("SCREEN_CHANGED")
      expect(run.steps[0].screenStability?.targetChanged).toBe(true)
      expect(h.vm.mouse.drag).not.toHaveBeenCalled()
    },
  )
  it("still requires NAVIGATE in supervised mode", async () => {
    const h = harness([scrollbarDecision()])
    h.deps.confirm.mockResolvedValue(false)
    const run = await runDesktopDryRun(env, h.deps)
    expect(run.stopReason).toBe("NAVIGATION_NOT_CONFIRMED")
    expect(h.vm.mouse.drag).not.toHaveBeenCalled()
  })
  it("stops rather than retrying a drag with unknown outcome", async () => {
    const h = harness([scrollbarDecision()])
    h.vm.mouse.drag.mockRejectedValue(new Error("private-sdk-body"))
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY")
    expect(h.vm.mouse.drag).toHaveBeenCalledOnce()
    expect(h.planner).toHaveBeenCalledOnce()
    expect(run.automaticDestructiveRetries).toBe(0)
    expect(JSON.stringify(run)).not.toContain("private-sdk-body")
  })
  it("keeps final candidates intercepted even with scrollbar geometry", async () => {
    const h = harness([scrollbarDecision({ type: "final_cancel_candidate" })])
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("FINAL_ACTION_BOUNDARY")
    expect(h.vm.mouse.drag).not.toHaveBeenCalled()
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    expect(run.destructiveClicksExecuted).toBe(0)
    expect(run.unsafeActionsExecuted).toBe(0)
  })
})

describe("ineffective page-navigation recovery", () => {
  const pageDown = () =>
    decision({
      type: "key",
      keys: ["Page_Down"],
      x: null,
      y: null,
      targetText: null,
    })
  const tab = () =>
    decision({ type: "key", keys: ["Tab"], x: null, y: null, targetText: null })
  it("can drag the observed scrollbar after an ineffective Page Down", async () => {
    const h = harness([pageDown(), scrollbarDecision(), decision()])
    const changed = await sharp(png()).negate().png().toBuffer()
    h.vm.mouse.drag.mockImplementation(async () => {
      h.vm.screenshot.mockResolvedValue(changed)
    })
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("FINAL_ACTION_BOUNDARY")
    expect(h.vm.keyboard.press.mock.calls).toEqual([[["Page_Down"]]])
    expect(h.vm.mouse.drag).toHaveBeenCalledOnce()
    expect(run.steps[1].navigationProgress?.screenChanged).toBe(true)
    expect(h.planner.mock.calls[2][0].pageNavigationStalled).toBe(false)
  })
  it("does not repeat an ineffective scrollbar drag", async () => {
    const h = harness([scrollbarDecision()])
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("NAVIGATION_NO_PROGRESS")
    expect(h.vm.mouse.drag).toHaveBeenCalledOnce()
    expect(h.planner).toHaveBeenCalledTimes(3)
    expect(h.vm.close).toHaveBeenCalledOnce()
  })
  it("bounds focus recovery instead of spending the budget on endless Tabs", async () => {
    const h = harness([pageDown(), tab()])
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("NAVIGATION_NO_PROGRESS")
    expect(h.vm.keyboard.press.mock.calls).toEqual([
      [["Page_Down"]],
      [["Tab"]],
      [["Tab"]],
    ])
    expect(h.planner).toHaveBeenCalledTimes(5)
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
  })
  it("allows another page key when the prior one actually changed the screen", async () => {
    const h = harness([pageDown(), pageDown(), decision()])
    const moved = await sharp({
      create: { width: 1280, height: 720, channels: 4, background: "black" },
    })
      .png()
      .toBuffer()
    let current = png()
    h.vm.screenshot.mockImplementation(async () => current)
    h.vm.keyboard.press.mockImplementation(async () => {
      current = current === moved ? png() : moved
    })
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(h.vm.keyboard.press).toHaveBeenCalledTimes(2)
    expect(run.steps[0].navigationProgress?.screenChanged).toBe(true)
    expect(h.planner.mock.calls[1][0].pageNavigationStalled).toBe(false)
    expect(run.stopReason).toBe("FINAL_ACTION_BOUNDARY")
  })
  it("a recovery Tab still stops on a fresh material screen change", async () => {
    const h = harness([pageDown(), tab()])
    const changed = await sharp({
      create: { width: 1280, height: 720, channels: 4, background: "black" },
    })
      .png()
      .toBuffer()
    let confirmations = 0
    h.deps.confirm.mockImplementation(async () => {
      if (++confirmations === 2) h.vm.screenshot.mockResolvedValue(changed)
      return true
    })
    const run = await runDesktopDryRun(env, h.deps)
    expect(run.stopReason).toBe("SCREEN_CHANGED")
    expect(h.vm.keyboard.press).toHaveBeenCalledOnce()
  })
  it("reports no progress to the next plan and uses a reviewed Tab without retrying Page Down", async () => {
    const h = harness([pageDown(), pageDown(), tab(), decision()])
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(h.vm.keyboard.press.mock.calls).toEqual([[["Page_Down"]], [["Tab"]]])
    expect(run.steps[0].navigationProgress).toMatchObject({
      screenChanged: false,
      changedPixelRatio: 0,
    })
    expect(h.planner.mock.calls[1][0]).toMatchObject({
      pageNavigationStalled: true,
    })
    expect(h.planner.mock.calls[1][0].history.join(" ")).toContain(
      "NO_VISIBLE_PROGRESS",
    )
    expect(run.steps[1]).toMatchObject({
      policy: "NAVIGATION_NO_PROGRESS",
      execution: "NOT_EXECUTED",
    })
    expect(run.stopReason).toBe("FINAL_ACTION_BOUNDARY")
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    expect(run.automaticDestructiveRetries).toBe(0)
    expect(run.destructiveClicksExecuted).toBe(0)
  })
  it("stops a planner that keeps asking for ineffective page keys after one read-only replan", async () => {
    const h = harness([pageDown()])
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("NAVIGATION_NO_PROGRESS")
    expect(h.planner).toHaveBeenCalledTimes(3)
    expect(h.vm.keyboard.press).toHaveBeenCalledOnce()
    expect(h.vm.close).toHaveBeenCalled()
    expect(h.vm.pause).not.toHaveBeenCalled()
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
  })
  it("still requires human NAVIGATE review and fresh stability for a recovery Tab", async () => {
    const h = harness([pageDown(), tab(), decision()])
    h.deps.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const run = await runDesktopDryRun(env, h.deps)
    expect(run.stopReason).toBe("NAVIGATION_NOT_CONFIRMED")
    expect(h.vm.keyboard.press.mock.calls).toEqual([[["Page_Down"]]])
  })
  it("never retries a key whose dispatch outcome is unknown", async () => {
    const h = harness([pageDown(), tab()])
    h.vm.keyboard.press.mockRejectedValueOnce(new Error("private-sdk-error"))
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY")
    expect(h.vm.keyboard.press).toHaveBeenCalledOnce()
    expect(h.planner).toHaveBeenCalledOnce()
  })
  it("keeps Enter blocked even when a prior page key made no progress", async () => {
    const h = harness([
      pageDown(),
      decision({ type: "key", keys: ["Enter"], targetText: null }),
    ])
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("KEY_NOT_ALLOWED")
    expect(h.vm.keyboard.press).toHaveBeenCalledOnce()
  })
})

describe("Desktop config and strict planner", () => {
  it.each([
    "SOLARI_DESKTOP_SESSION_ID",
    "CLEANBREAK_DRY_RUN",
    "CLEANBREAK_REAL_PROVIDER_AUTHORIZED",
  ])("requires explicit %s before any VM work", async (key) => {
    const h = harness()
    await expect(
      runDesktopDryRun({ ...env, [key]: undefined }, h.deps),
    ).rejects.toThrow(key)
    expect(h.client.connect).not.toHaveBeenCalled()
  })
  it("retains browser as the default executor", () => {
    expect(realProviderExecutor({})).toBe("browser")
    expect(realProviderExecutor(env)).toBe("desktop")
    expect(() =>
      realProviderExecutor({ CLEANBREAK_REAL_PROVIDER_EXECUTOR: "unknown" }),
    ).toThrow()
  })
  it("rejects non-dry-run and credential-bearing gateway URLs", () => {
    expect(() =>
      readDesktopConfig({ ...env, CLEANBREAK_DRY_RUN: "false" }),
    ).toThrow("CLEANBREAK_DRY_RUN")
    expect(() =>
      readDesktopConfig({
        ...env,
        SOLARI_DESKTOP_BASE_URL: "https://user:password@bad.example",
      }),
    ).toThrow("HTTPS origin")
  })
  it("sends screenshot, dimensions, goal and bounded history through strict Structured Outputs", async () => {
    const parse = vi.fn(async (_options: unknown) => ({
      output_parsed: decision(),
      usage: { input_tokens: 20, output_tokens: 10 },
    }))
    const planner = createDesktopPlanner(readDesktopConfig(env).agent, {
      responses: { parse },
    })
    const result = await planner({
      screenshot: png(),
      width: 1280,
      height: 720,
      allowedOrigin: "https://provider.example",
      history: Array.from({ length: 20 }, (_, i) => `step-${i}`),
    })
    const options = parse.mock.calls[0][0] as {
      store: boolean
      input: Array<{ role: string; content: unknown }>
      text: {
        format: {
          strict: boolean
          schema: { additionalProperties: boolean; required: string[] }
        }
      }
    }
    expect(options.store).toBe(false)
    expect(options.text.format.strict).toBe(true)
    expect(options.text.format.schema.additionalProperties).toBe(false)
    expect(options.text.format.schema.required).toContain("type")
    expect(options.text.format.schema.required).toContain("flowStage")
    expect(options.input[0].role).toBe("developer")
    const parts = options.input[1].content as Array<{
      type: string
      text?: string
      image_url?: string
    }>
    expect(JSON.parse(parts[0].text!).history).toHaveLength(6)
    expect(JSON.parse(parts[0].text!)).toMatchObject({
      width: 1280,
      height: 720,
    })
    expect(parts[1].image_url).toBe(
      `data:image/png;base64,${png().toString("base64")}`,
    )
    expect(result.tokens).toBe(30)
    expect(options.input[0].content).toContain("cancel_flow_navigation")
    expect(options.input[0].content).toContain("ANY uncertainty")
    expect(options.input[0].content).not.toContain("ANY cancellation control")
    for (const key of SAFE_DESKTOP_NAVIGATION_KEYS)
      expect(options.input[0].content).toContain(key)
    expect(options.input[0].content).toContain("never\nkeyboard activation")
  })
  it("rejects arbitrary code and missing structured fields", () => {
    expect(() =>
      desktopDecisionSchema.parse({ ...decision(), code: "exec(...)" }),
    ).toThrow()
    expect(() => desktopDecisionSchema.parse({ type: "click" })).toThrow()
  })
})

describe("offline visual Desktop dry-run lifecycle", () => {
  it("reconnects an existing VM, intercepts final action, and closes without pausing", async () => {
    const h = harness([
      decision({ type: "click", targetText: "Billing" }),
      decision(),
    ])
    h.vm.health.mockResolvedValueOnce({ ready: false })
    const result = await runDesktopDryRun(env, h.deps)
    expect(h.client.connect).toHaveBeenCalledExactlyOnceWith(
      env.SOLARI_DESKTOP_SESSION_ID,
    )
    expect(h.vm.connect).toHaveBeenCalledOnce()
    expect(h.vm.health).toHaveBeenCalledTimes(2)
    expect(h.evidence.screenshot).toHaveBeenCalledTimes(2)
    expect(h.vm.mouse.click).toHaveBeenCalledExactlyOnceWith(200, 300)
    expect(h.deps.confirm).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      state: "AWAITING_APPROVAL",
      paused: false,
      controlClosed: true,
      destructiveClicksExecuted: 0,
      unsafeActionsExecuted: 0,
    })
    expect(result.steps[1].execution).toBe("NOT_EXECUTED")
    expect(h.vm.record.start).toHaveBeenCalledOnce()
    expect(h.vm.record.stop).toHaveBeenCalledOnce()
    expect(h.vm.pause).not.toHaveBeenCalled()
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(h.vm.destroy).not.toHaveBeenCalled()
    expect(h.viewer.close).toHaveBeenCalledOnce()
  })
  it("never clicks a final candidate or a cancellation mislabelled as click", async () => {
    for (const type of ["click", "final_cancel_candidate"] as const) {
      const h = harness([decision({ type })])
      expect((await runDesktopDryRun(env, h.deps)).state).toBe(
        "AWAITING_APPROVAL",
      )
      expect(h.vm.mouse.click).not.toHaveBeenCalled()
      expect(h.deps.confirm).not.toHaveBeenCalled()
    }
  })
  it.each([
    [{ confidence: 0.2 }, "LOW_CONFIDENCE"],
    [{ targetText: "Delete my account" }, "ACCOUNT_DELETION"],
    [{ targetText: "Accept offer" }, "RETENTION_OFFER"],
    [{ pageStatus: "challenge" }, "ANTI_BOT_CHALLENGE"],
    [{ pageStatus: "login" }, "LOGIN_REQUIRED"],
    [{ observedOrigin: "https://unrelated.example" }, "UNRELATED_ORIGIN"],
    [{ destinationOrigin: "https://unrelated.example" }, "UNRELATED_ORIGIN"],
    [{ pageStatus: "unknown" }, "PROVIDER_NOT_ESTABLISHED"],
    [{ x: 1280 }, "INVALID_COORDINATES"],
    [{ type: "key", targetText: null, keys: ["Return"] }, "KEY_NOT_ALLOWED"],
    [
      { type: "scroll", targetText: null, deltaY: 100 },
      "SCROLLBAR_NOT_ESTABLISHED",
    ],
    [
      { type: "type", targetText: "Password", text: "private-password" },
      "UNSAFE_TARGET",
    ],
  ] as Array<[Partial<DesktopDecision>, string]>)(
    "fails closed on unsafe decision %#",
    async (patch, code) => {
      const h = harness([decision({ type: "click", ...patch })])
      const result = await runDesktopDryRun(env, h.deps)
      expect(result.stopReason).toBe(code)
      expect(result.state).toBe("FAILED")
      expect(h.vm.mouse.click).not.toHaveBeenCalled()
      expect(h.vm.keyboard.press).not.toHaveBeenCalled()
      expect(h.vm.keyboard.type).not.toHaveBeenCalled()
      expect(h.vm.pause).not.toHaveBeenCalled()
      expect(h.vm.close).toHaveBeenCalledOnce()
    },
  )
  it("bounds steps and preserves only bounded tool history", async () => {
    const h = harness([
      decision({ type: "key", targetText: null, keys: ["Tab"] }),
    ])
    const result = await runDesktopDryRun(
      { ...env, CLEANBREAK_AGENT_MAX_STEPS: "8" },
      h.deps,
    )
    expect(result.stopReason).toBe("MAX_STEPS")
    expect(h.planner).toHaveBeenCalledTimes(8)
    expect(h.planner.mock.calls.at(-1)![0].history).toHaveLength(6)
  })
  it("bounds total model tokens before dispatch", async () => {
    const h = harness()
    h.planner.mockResolvedValue({ decision: decision(), tokens: 20_001 })
    expect(
      (
        await runDesktopDryRun(
          { ...env, CLEANBREAK_DESKTOP_MAX_TOKENS: "20000" },
          h.deps,
        )
      ).stopReason,
    ).toBe("TOKEN_BUDGET")
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
  })
  it("budgets a full screenshot workflow rather than only its first five frames", async () => {
    const h = harness([
      ...Array.from({ length: 7 }, () =>
        decision({ type: "key", keys: ["Tab"], targetText: null }),
      ),
      decision(),
    ])
    const sequence = h.planner.getMockImplementation()!
    h.planner.mockImplementation(async (input) => ({
      ...(await sequence(input)),
      tokens: 4200,
    }))
    const run = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(run.stopReason).toBe("FINAL_ACTION_BOUNDARY")
    expect(run.planningBudget).toMatchObject({
      maxTokens: 100000,
      usedTokens: 33600,
      remainingTokens: 66400,
    })
    expect(run.steps[5].planning).toMatchObject({
      totalTokens: 4200,
      cumulativeTokens: 25200,
      limit: 100000,
    })
    expect(h.vm.keyboard.press).toHaveBeenCalledTimes(7)
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
  })
  it("records safe usage on the failed planner step without any input", async () => {
    const h = harness()
    h.planner.mockRejectedValue(
      new DesktopPlanningFailure("TOKEN_BUDGET", {
        inputTokens: 19500,
        outputTokens: 600,
        totalTokens: 20100,
      }),
    )
    const progress = vi.fn()
    const run = await runDesktopDryRun(
      { ...env, CLEANBREAK_DESKTOP_MAX_TOKENS: "20000" },
      { ...h.deps, auto: true, progress },
    )
    expect(run.stopReason).toBe("TOKEN_BUDGET")
    expect(run.steps[0]).toMatchObject({
      policy: "TOKEN_BUDGET",
      policyResult: "BLOCK",
      execution: "NOT_EXECUTED",
      planning: {
        inputTokens: 19500,
        outputTokens: 600,
        totalTokens: 20100,
        cumulativeTokens: 20100,
        limit: 20000,
      },
    })
    expect(run.planningBudget?.remainingTokens).toBe(0)
    expect(progress).toHaveBeenCalledWith("step 1: planning tokens 20100/20000")
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    expect(h.vm.mouse.drag).not.toHaveBeenCalled()
    expect(h.vm.keyboard.press).not.toHaveBeenCalled()
    expect(h.vm.close).toHaveBeenCalledOnce()
  })
  it("limits typing to the fixed neutral cancellation reason", () => {
    expect(
      desktopPolicy(
        decision({
          type: "type",
          targetText: "cancellation reason",
          text: NEUTRAL_REASON,
        }),
        "https://provider.example",
        1280,
        720,
        0.7,
      ).result,
    ).toBe("ALLOW")
    expect(
      desktopPolicy(
        decision({
          type: "type",
          targetText: "cancellation reason",
          text: "private-token",
        }),
        "https://provider.example",
        1280,
        720,
        0.7,
      ).result,
    ).toBe("BLOCK")
  })
  it("requires fresh human confirmation and fails closed on screenshot decode failure", async () => {
    const h = harness([decision({ type: "click", targetText: "Billing" })])
    h.deps.confirm.mockResolvedValue(false)
    expect((await runDesktopDryRun(env, h.deps)).stopReason).toBe(
      "NAVIGATION_NOT_CONFIRMED",
    )
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    const changed = harness([
      decision({ type: "click", targetText: "Billing" }),
    ])
    const next = png()
    next[8] = 1
    changed.vm.screenshot.mockResolvedValueOnce(png()).mockResolvedValue(next)
    expect((await runDesktopDryRun(env, changed.deps)).stopReason).toBe(
      "SCREEN_CHANGED",
    )
    expect(changed.vm.mouse.click).not.toHaveBeenCalled()
  })
  it.each(SAFE_DESKTOP_NAVIGATION_KEYS)(
    "%s permits tiny drift after confirmation and preserves the audit hash",
    async (key) => {
      const h = harness([
        decision({ type: "key", targetText: null, keys: [key] }),
        decision(),
      ])
      h.vm.screenshot
        .mockResolvedValueOnce(png())
        .mockResolvedValueOnce(await drift())
      const result = await runDesktopDryRun(env, h.deps)
      expect(result.state).toBe("AWAITING_APPROVAL")
      expect(h.vm.keyboard.press).toHaveBeenCalledExactlyOnceWith(
        key === "Shift+Tab" ? ["Shift", "Tab"] : [key],
      )
      expect(h.vm.mouse.click).not.toHaveBeenCalled()
      expect(h.deps.confirm.mock.invocationCallOrder[0]).toBeLessThan(
        h.vm.screenshot.mock.invocationCallOrder[1],
      )
      const hash = createHash("sha256").update(png()).digest("hex")
      expect(result.steps[0].screenshotHash).toBe(hash)
      expect(h.deps.confirm).toHaveBeenCalledWith(
        1,
        result.steps[0].decision,
        hash.slice(0, 12),
      )
      expect(result.steps[0].screenStability).toMatchObject({
        stable: true,
        changedPixelRatio: 40 / (1280 * 720),
        threshold: 0.005,
        targetPadding: null,
      })
      expect(h.evidence.job).toHaveBeenLastCalledWith(result)
      // Existing planning images only: the fresh comparison image is not saved.
      expect(h.evidence.screenshot).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(result)).not.toContain(png().toString("base64"))
      expect(result.destructiveClicksExecuted).toBe(0)
    },
  )
  it.each([false, true])(
    "click drift near target=%s is guarded without retries",
    async (nearTarget) => {
      const h = harness([
        decision({ type: "click", targetText: "Billing" }),
        decision(),
      ])
      h.vm.screenshot
        .mockResolvedValueOnce(png())
        .mockResolvedValueOnce(
          await drift(nearTarget ? 200 : 10, nearTarget ? 300 : 10),
        )
      const result = await runDesktopDryRun(env, h.deps)
      expect(h.vm.mouse.click).toHaveBeenCalledTimes(nearTarget ? 0 : 1)
      expect(h.deps.confirm).toHaveBeenCalledOnce()
      expect(result.stopReason).toBe(
        nearTarget ? "SCREEN_CHANGED" : "FINAL_ACTION_BOUNDARY",
      )
      expect(result.steps[0].screenStability).toMatchObject({
        stable: !nearTarget,
        targetChanged: nearTarget,
      })
      expect(result.destructiveClicksExecuted).toBe(0)
      expect(result.unsafeActionsExecuted).toBe(0)
      expect(h.vm.pause).not.toHaveBeenCalled()
      expect(h.vm.close).toHaveBeenCalledOnce()
    },
  )
  it("does not retry an input whose outcome is unknown", async () => {
    const h = harness([decision({ type: "click", targetText: "Billing" })])
    h.vm.mouse.click.mockRejectedValue(new Error("private-cookie"))
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.stopReason).toBe("ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY")
    expect(h.vm.mouse.click).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain("private-cookie")
  })
  it.each([
    "connect",
    "health",
    "screenshot",
    "planner",
    "recording",
    "confirmation",
  ])("closes without pausing on %s failure", async (phase) => {
    const h = harness([decision({ type: "click", targetText: "Billing" })])
    const error = new Error("private-sdk-error")
    if (phase === "connect") h.vm.connect.mockRejectedValue(error)
    if (phase === "health") h.vm.health.mockResolvedValue({ ready: false })
    if (phase === "screenshot") h.vm.screenshot.mockRejectedValue(error)
    if (phase === "planner") h.planner.mockRejectedValue(error)
    if (phase === "recording") h.vm.record.start.mockRejectedValue(error)
    if (phase === "confirmation") h.deps.confirm.mockRejectedValue(error)
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.state).toBe("FAILED")
    expect(h.vm.pause).not.toHaveBeenCalled()
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain("private-sdk-error")
  })
  it("never pauses the shared VM even when attaching fails", async () => {
    const h = harness()
    h.client.connect.mockRejectedValue(new Error("private-url"))
    expect((await runDesktopDryRun(env, h.deps)).paused).toBe(false)
    expect(h.client.pause).not.toHaveBeenCalled()
    const fallback = harness()
    fallback.vm.pause.mockRejectedValue(new Error("private"))
    expect((await runDesktopDryRun(env, fallback.deps)).paused).toBe(false)
    expect(fallback.client.pause).not.toHaveBeenCalled()
    expect(fallback.vm.pause).not.toHaveBeenCalled()
    expect(fallback.vm.close).toHaveBeenCalledOnce()
  })
  it("does not report success if local control cleanup fails", async () => {
    const h = harness()
    h.vm.close.mockImplementation(() => {
      throw new Error()
    })
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.state).toBe("FAILED")
    expect(result.paused).toBe(false)
    expect(h.vm.close).toHaveBeenCalledOnce()
  })
  it("stops on interruption before any model-directed input and closes only", async () => {
    const h = harness()
    const controller = new AbortController()
    h.deps.prepare.mockImplementation(async () => {
      controller.abort()
      return true
    })
    expect(
      (await runDesktopDryRun(env, { ...h.deps, signal: controller.signal }))
        .stopReason,
    ).toBe("INTERRUPTED")
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    expect(h.vm.pause).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    "redacts model free text and keeps capabilities out of validation artifacts (auto=%s)",
    async (auto) => {
      const root = mkdtempSync(join(tmpdir(), "cleanbreak-desktop-test-"))
      const h = harness([
        decision({
          type: "cancel_flow_navigation",
          targetText: "Start cancellation",
          visibleText: "Step 1 of 3",
          flowStage: "CANCELLATION_ENTRY",
        }),
        decision({
          flowStage: "FINAL_CONFIRMATION",
          reasoning: "password private-password user@example.com",
          visibleText: "private-token",
          reason: "https://secret.example?token=private-token",
        }),
      ])
      const evidence = desktopEvidence("safe-run", root)
      try {
        const result = await runDesktopDryRun(env, {
          ...h.deps,
          auto,
          id: "safe-run",
          evidence,
        })
        const artifact = readFileSync(
          join(evidence.directory, "validation.json"),
          "utf8",
        )
        const job = readFileSync(join(evidence.directory, "job.json"), "utf8")
        expect(job).toContain(env.SOLARI_DESKTOP_SESSION_ID)
        for (const secret of [
          env.SOLARI_API_KEY!,
          env.OPENAI_API_KEY!,
          env.SOLARI_DESKTOP_SESSION_ID!,
          "private-password",
          "private-token",
          "user@example.com",
          "private-stream-sentinel",
          "private-recording-sentinel",
        ])
          expect(artifact).not.toContain(secret)
        for (const secret of [
          "private-password",
          "private-token",
          "private-stream-sentinel",
          "private-recording-sentinel",
        ])
          expect(job).not.toContain(secret)
        expect(evidence.validation({ ...result, state: "FAILED" })).toBe(false)
      } finally {
        for (const file of readdirSync(evidence.directory))
          unlinkSync(join(evidence.directory, file))
        rmdirSync(evidence.directory)
        rmdirSync(root)
      }
    },
  )
})

describe("exact Desktop navigation key boundary", () => {
  it("accepts the SDK Shift+Tab chord and preserves it in safe evidence", async () => {
    const proposed = decision({
      type: "key",
      targetText: null,
      keys: ["Shift", "Tab"],
    })
    const h = harness([proposed, decision()])
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.stopReason).toBe("FINAL_ACTION_BOUNDARY")
    expect(h.vm.keyboard.press).toHaveBeenCalledExactlyOnceWith([
      "Shift",
      "Tab",
    ])
    expect(result.steps[0].decision?.keys).toEqual(["Shift", "Tab"])
    expect(h.deps.confirm).toHaveBeenCalledOnce()
    expect(result.destructiveClicksExecuted).toBe(0)
  })
  it.each(
    [
      ["Enter"],
      ["Return"],
      ["Space"],
      ["space"],
      [" "],
      ["Delete"],
      ["Backspace"],
      ["Ctrl", "Tab"],
      ["Control", "ArrowDown"],
      ["Alt", "ArrowLeft"],
      ["Meta", "Tab"],
      ["Super", "Tab"],
      ["Ctrl+Tab"],
      ["F1"],
      ["F12"],
      ["a"],
      ["private-key-sentinel"],
      ["tab"],
      ["Shift"],
      ["Shift", "ArrowDown"],
      ["Tab", "Shift"],
      ["Tab", "Enter"],
      ["Shift", "Tab", "Return"],
      ["Tab", "Tab"],
      [],
      null,
    ].map((keys) => ({ keys })),
  )(
    "rejects non-allowlisted key input %# without dispatch or logging",
    async ({ keys }) => {
      const proposed = decision({ type: "key", targetText: null, keys })
      expect(
        desktopPolicy(proposed, "https://provider.example", 1280, 720, 0.9)
          .code,
      ).toBe("KEY_NOT_ALLOWED")
      expect(safeDesktopDecision(proposed).keys).toBeNull()
      const h = harness([proposed])
      expect(
        await executeNavigation(h.vm as unknown as DesktopHandle, proposed),
      ).toBe("ACTION_NOT_DISPATCHED")
      const result = await runDesktopDryRun(env, h.deps)
      expect(result.stopReason).toBe("KEY_NOT_ALLOWED")
      expect(h.vm.keyboard.press).not.toHaveBeenCalled()
      expect(h.vm.keyboard.type).not.toHaveBeenCalled()
      expect(h.vm.mouse.click).not.toHaveBeenCalled()
      expect(h.deps.confirm).not.toHaveBeenCalled()
      expect(result.destructiveClicksExecuted).toBe(0)
    },
  )
  it("requires confirmation and never retries failed keyboard navigation", async () => {
    const proposed = decision({ type: "key", targetText: null, keys: ["Tab"] })
    const denied = harness([proposed])
    denied.deps.confirm.mockResolvedValue(false)
    expect((await runDesktopDryRun(env, denied.deps)).stopReason).toBe(
      "NAVIGATION_NOT_CONFIRMED",
    )
    expect(denied.vm.keyboard.press).not.toHaveBeenCalled()
    const failed = harness([proposed])
    failed.vm.keyboard.press.mockRejectedValue(new Error("private-sdk-error"))
    expect((await runDesktopDryRun(env, failed.deps)).stopReason).toBe(
      "ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY",
    )
    expect(failed.vm.keyboard.press).toHaveBeenCalledOnce()
  })
})

describe("reversible cancellation flow and final boundary", () => {
  const navigation = (patch: Partial<DesktopDecision> = {}) =>
    decision({
      type: "cancel_flow_navigation",
      targetText: "Start cancellation",
      visibleText: "Step 1 of 3. Another review step follows.",
      flowStage: "CANCELLATION_ENTRY",
      ...patch,
    })
  const policy = (patch: Partial<DesktopDecision> = {}) =>
    desktopPolicy(navigation(patch), "https://provider.example", 1280, 720, 0.9)

  it.each([
    "Start cancellation",
    "Continue cancellation",
    "Proceed with cancellation",
    "Proceed to cancellation",
    "Review cancellation",
    "Manage cancellation",
  ])("allows only reviewed reversible navigation for %s", (targetText) => {
    expect(policy({ targetText })).toEqual({
      result: "ALLOW",
      code: "HUMAN_NAVIGATION_REVIEW_REQUIRED",
    })
  })
  it.each([
    "Confirm cancellation",
    "Cancel now",
    "End trial",
    "End subscription",
    "Yes, cancel",
    "Complete cancellation",
    "Finish cancellation",
    "Final cancellation",
    "End now",
    "Turn off renewal",
    "Stop renewal",
    "Cancel subscription",
    "Cancel plan",
  ])("intercepts %s even when the model calls it reversible", (targetText) => {
    expect(policy({ targetText })).toEqual({
      result: "INTERCEPT",
      code: "FINAL_ACTION_BOUNDARY",
    })
    expect(policy({ targetText, type: "click" }).result).toBe("INTERCEPT")
  })
  it.each([
    "Confirm",
    "Complete",
    "Finish",
    "Final",
    "Yes, cancel",
    "Cancel now",
    "End now",
    "End trial",
    "End subscription",
    "Effective immediately",
    "Turn off renewal",
    "Stop renewal",
    "Your plan will be cancelled",
    "Your plan will be canceled",
    "Your trial will end",
    "You lose access",
    "No further charges",
    "Cancellation fee",
    "You will be charged a fee",
  ])("destructive context %s overrides the navigation allowlist", (cue) => {
    expect(policy({ visibleText: `Step 1 of 3. ${cue}` }).result).toBe(
      "INTERCEPT",
    )
    expect(
      policy({ type: "click", targetText: "Continue", visibleText: cue })
        .result,
    ).toBe("INTERCEPT")
  })
  it.each([
    null,
    "",
    "Cancel your subscription",
    "Step 3 of 3",
    "Step 0 of 3",
    "No additional review step follows",
  ])("intercepts ambiguous/missing reversibility context %s", (visibleText) => {
    expect(policy({ visibleText }).result).toBe("INTERCEPT")
  })
  it.each([
    { x: null },
    { y: null },
    { x: -1 },
    { y: 720 },
    { pageStatus: "unknown" },
    { pageStatus: "login" },
    { pageStatus: "challenge" },
    { observedOrigin: "https://other.example" },
    { destinationOrigin: "https://other.example" },
    { confidence: 0.89 },
  ] as Partial<DesktopDecision>[])(
    "rejects missing authorization/context %#",
    (patch) => {
      expect(policy(patch).result).toBe("BLOCK")
    },
  )
  it.each([
    "Accept offer",
    "Pause subscription",
    "Downgrade",
    "Upgrade",
    "Purchase",
    "Payment",
    "Security",
    "Delete account",
  ])("never permits prohibited retention/account action %s", (targetText) => {
    expect(policy({ type: "click", targetText }).result).not.toBe("ALLOW")
  })
  it("always intercepts explicit final candidates and has no dispatcher for them", async () => {
    const h = harness()
    const final = decision({
      x: null,
      y: null,
      targetText: null,
      pageStatus: "unknown",
      confidence: 0,
    })
    expect(
      desktopPolicy(final, "https://provider.example", 1280, 720, 0.9).result,
    ).toBe("INTERCEPT")
    expect(
      await executeNavigation(h.vm as unknown as DesktopHandle, final),
    ).toBe("ACTION_NOT_DISPATCHED")
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    expect(h.vm.keyboard.press).not.toHaveBeenCalled()
    expect(h.vm.keyboard.type).not.toHaveBeenCalled()
    const result = await runDesktopDryRun(env, {
      ...h.deps,
      planner: async () => ({ decision: final, tokens: 1 }),
    })
    expect(result.stopReason).toBe("FINAL_ACTION_BOUNDARY")
    expect(result.proposedAction).toBeNull()
    expect(successfulDesktopValidation(result)).toBe(false)
  })
  it("traverses entry, retention rejection, neutral reason and review, then never dispatches final", async () => {
    const h = harness([
      navigation(),
      decision({
        type: "click",
        targetText: "No thanks",
        visibleText: "Keep your current plan at a discount",
        flowStage: "RETENTION",
      }),
      decision({
        type: "type",
        targetText: "cancellation reason",
        text: NEUTRAL_REASON,
        flowStage: "REASON",
      }),
      navigation({ targetText: "Continue cancellation", flowStage: "REVIEW" }),
      decision({ flowStage: "FINAL_CONFIRMATION" }),
    ])
    const result = await runDesktopDryRun(env, h.deps)
    expect(result).toMatchObject({
      state: "AWAITING_APPROVAL",
      stopReason: "FINAL_ACTION_BOUNDARY",
      destructiveClicksExecuted: 0,
      unsafeActionsExecuted: 0,
    })
    expect(h.vm.mouse.click).toHaveBeenCalledTimes(3)
    expect(h.vm.keyboard.type).toHaveBeenCalledExactlyOnceWith(NEUTRAL_REASON)
    expect(h.deps.confirm).toHaveBeenCalledTimes(4)
    expect(result.steps.map((step) => step.flowStage)).toEqual([
      "CANCELLATION_ENTRY",
      "RETENTION",
      "REASON",
      "REVIEW",
      "FINAL_CONFIRMATION",
    ])
    expect(result.steps.at(-1)?.execution).toBe("NOT_EXECUTED")
    expect(result.steps[0].screenStability?.targetPadding).toBe(32)
    expect(successfulDesktopValidation(result)).toBe(true)
    expect(
      successfulDesktopValidation({
        ...result,
        steps: result.steps.slice(1, 3).concat(result.steps.slice(-1)),
      }),
    ).toBe(false)
    expect(
      successfulDesktopValidation({ ...result, stopReason: "SCREEN_CHANGED" }),
    ).toBe(false)
    expect(
      successfulDesktopValidation({ ...result, controlClosed: false }),
    ).toBe(false)
    expect(
      successfulDesktopValidation({
        ...result,
        destructiveClicksExecuted: 1,
      } as unknown as typeof result),
    ).toBe(false)
    expect(
      successfulDesktopValidation({
        ...result,
        unsafeActionsExecuted: 1,
      } as unknown as typeof result),
    ).toBe(false)
  })
  it("does not count an early boundary as completed validation", async () => {
    const h = harness([decision()])
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.state).toBe("AWAITING_APPROVAL")
    expect(successfulDesktopValidation(result)).toBe(false)
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
  })
  it.each([
    { pageStatus: "unknown" },
    { observedOrigin: "https://other.example" },
    { confidence: 0 },
  ] as Partial<DesktopDecision>[])(
    "intercepts but does not validate an unestablished final candidate %#",
    async (patch) => {
      const h = harness([navigation(), decision(patch)])
      const result = await runDesktopDryRun(env, h.deps)
      expect(result.stopReason).toBe("FINAL_ACTION_BOUNDARY")
      expect(result.proposedAction).toBeNull()
      expect(successfulDesktopValidation(result)).toBe(false)
      expect(h.vm.mouse.click).toHaveBeenCalledOnce()
    },
  )
  it("still requires human confirmation for cancellation navigation", async () => {
    const h = harness([navigation()])
    h.deps.confirm.mockResolvedValue(false)
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.stopReason).toBe("NAVIGATION_NOT_CONFIRMED")
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    expect(h.deps.confirm).toHaveBeenCalledOnce()
  })
  it("applies target-local visual drift protection to cancellation navigation", async () => {
    const h = harness([navigation()])
    h.vm.screenshot
      .mockResolvedValueOnce(png())
      .mockResolvedValueOnce(await drift(200, 300))
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.stopReason).toBe("SCREEN_CHANGED")
    expect(result.steps[0].screenStability?.targetChanged).toBe(true)
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
  })
  it("never retries a cancellation navigation whose click outcome is unknown", async () => {
    const h = harness([navigation()])
    h.vm.mouse.click.mockRejectedValue(new Error("private-sdk-error"))
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.stopReason).toBe("ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY")
    expect(h.vm.mouse.click).toHaveBeenCalledOnce()
    expect(result.destructiveClicksExecuted).toBe(0)
    expect(result.unsafeActionsExecuted).toBe(0)
    expect(successfulDesktopValidation(result)).toBe(false)
  })
})

describe("autonomous Desktop dry run", () => {
  const flow = () => [
    decision({ type: "click", targetText: "Billing", flowStage: "BILLING" }),
    decision({
      type: "cancel_flow_navigation",
      targetText: "Manage cancellation",
      visibleText: "Step 1 of 4",
      flowStage: "CANCELLATION_ENTRY",
    }),
    decision({
      type: "cancel_flow_navigation",
      targetText: "Start cancellation",
      visibleText: "Step 2 of 4",
      flowStage: "CANCELLATION_ENTRY",
    }),
    decision({
      type: "click",
      targetText: "No thanks",
      visibleText: "Keep your plan at a discount",
      flowStage: "RETENTION",
    }),
    decision({
      type: "click",
      targetText: "No longer needed",
      visibleText: "Cancellation reason",
      flowStage: "REASON",
    }),
    decision({
      type: "type",
      targetText: "cancellation reason",
      text: NEUTRAL_REASON,
      flowStage: "REASON",
    }),
    decision({
      type: "cancel_flow_navigation",
      targetText: "Continue cancellation",
      visibleText: "Another review step follows",
      flowStage: "REVIEW",
    }),
    decision({
      targetText: "Confirm cancellation",
      visibleText: "Your trial will end",
      flowStage: "FINAL_CONFIRMATION",
    }),
  ]
  it("dispatches only ALLOW decisions and reaches the final boundary without any prompts", async () => {
    const h = harness(flow())
    const progress = vi.fn()
    const result = await runDesktopDryRun(env, {
      ...h.deps,
      auto: true,
      progress,
    })
    expect(result).toMatchObject({
      mode: "auto",
      state: "AWAITING_APPROVAL",
      stopReason: "FINAL_ACTION_BOUNDARY",
      finalBoundaryEstablished: true,
      automaticDestructiveRetries: 0,
      destructiveClicksExecuted: 0,
      unsafeActionsExecuted: 0,
      paused: false,
      controlClosed: true,
    })
    expect(h.deps.prepare).not.toHaveBeenCalled()
    expect(h.deps.confirm).not.toHaveBeenCalled()
    expect(h.deps.reviewRecording).not.toHaveBeenCalled()
    expect(h.vm.mouse.click).toHaveBeenCalledTimes(6)
    expect(h.vm.keyboard.type).toHaveBeenCalledExactlyOnceWith(NEUTRAL_REASON)
    expect(result.steps.at(-1)?.execution).toBe("NOT_EXECUTED")
    expect(successfulDesktopValidation(result)).toBe(true)
    expect(
      result.steps
        .slice(0, -1)
        .every((step) => step.transitionStability?.stable),
    ).toBe(true)
    expect(h.deps.sleep).toHaveBeenCalledWith(750)
    expect(progress).toHaveBeenCalledWith(
      "step 8: final_cancel_candidate -> INTERCEPT",
    )
    expect(progress.mock.calls.flat().join(" ")).not.toContain(
      "Your trial will end",
    )
  })
  it("CLI --auto works without a TTY and prints successful output without START/NAVIGATE", async () => {
    const h = harness(flow())
    const confirm = vi.fn(async () => true)
    const output = vi.fn()
    const run = vi.fn(async (environment, supplied) =>
      runDesktopDryRun(environment, { ...h.deps, ...supplied }),
    )
    expect(
      await desktopDryRunCommand(["--auto"], env, {
        run,
        interactive: false,
        confirm,
        output,
      }),
    ).toBe(0)
    expect(confirm).not.toHaveBeenCalled()
    const logs = output.mock.calls.flat().join(" ")
    expect(logs).not.toContain("START")
    expect(logs).not.toContain("NAVIGATE")
    expect(logs).not.toContain("private-")
    expect(JSON.parse(output.mock.calls.at(-1)![0])).toMatchObject({
      mode: "auto",
      state: "AWAITING_APPROVAL",
      stopReason: "FINAL_ACTION_BOUNDARY",
      automaticDestructiveRetries: 0,
      destructiveClicksExecuted: 0,
      unsafeActionsExecuted: 0,
      paused: false,
      controlClosed: true,
      validation: "artifacts/desktop/test-desktop-run/validation.json",
    })
  })
  it("default CLI retains START, NAVIGATE and recording-review prompts", async () => {
    const h = harness(flow())
    const confirm = vi.fn(async () => true)
    const run = vi.fn(async (environment, supplied) =>
      runDesktopDryRun(environment, { ...h.deps, ...supplied }),
    )
    expect(
      await desktopDryRunCommand([], env, {
        run,
        interactive: true,
        confirm,
        output: vi.fn(),
      }),
    ).toBe(0)
    expect(confirm.mock.calls.length).toBe(9)
    expect(run.mock.calls[0][1]?.auto).toBe(false)
  })
  it("rejects unknown CLI flags and still requires a TTY for supervised mode", async () => {
    const run = vi.fn()
    for (const args of [["--unknown"], ["--auto", "--auto"], []])
      expect(
        await desktopDryRunCommand(args, env, {
          run,
          interactive: false,
          output: vi.fn(),
        }),
      ).toBe(1)
    expect(run).not.toHaveBeenCalled()
  })
  it.each([
    { type: "click", targetText: "Delete account" },
    { type: "click", targetText: "Accept offer" },
    { type: "click", targetText: "Buy" },
    { type: "key", targetText: null, keys: ["Space"] },
    {
      type: "click",
      targetText: "Billing",
      observedOrigin: "https://other.example",
    },
    { type: "click", targetText: "Billing", pageStatus: "login" },
    { type: "click", targetText: "Billing", pageStatus: "challenge" },
  ] as Partial<DesktopDecision>[])(
    "auto stops on BLOCK before any dispatch %#",
    async (patch) => {
      const h = harness([decision(patch)])
      const result = await runDesktopDryRun(env, { ...h.deps, auto: true })
      expect(result.steps[0].policyResult).toBe("BLOCK")
      expect(h.vm.mouse.click).not.toHaveBeenCalled()
      expect(h.vm.keyboard.press).not.toHaveBeenCalled()
      expect(h.vm.keyboard.type).not.toHaveBeenCalled()
      expect(result.automaticDestructiveRetries).toBe(0)
      expect(result.paused).toBe(false)
      expect(result.controlClosed).toBe(true)
    },
  )
  it.each([
    "Confirm cancellation",
    "Cancel now",
    "End trial",
    "Cancel subscription",
  ])("auto cannot dispatch model-misclassified %s", async (targetText) => {
    const h = harness([
      decision({
        type: "cancel_flow_navigation",
        targetText,
        visibleText: "Step 1 of 3",
      }),
    ])
    const result = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(result.steps[0].policyResult).toBe("INTERCEPT")
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    expect(successfulDesktopValidation(result)).toBe(false)
  })
  it("does not claim an ambiguous intermediate boundary is successful in auto", async () => {
    const h = harness([
      flow()[1],
      decision({
        targetText: "Cancel subscription",
        visibleText: "Subscription",
        flowStage: "CANCELLATION_ENTRY",
      }),
    ])
    const result = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(result.state).toBe("AWAITING_APPROVAL")
    expect(result.finalBoundaryEstablished).toBe(false)
    expect(successfulDesktopValidation(result)).toBe(false)
  })
  it("allows ambiguous entry only with explicit visible review-opening context", () => {
    const proposed = decision({
      type: "cancel_flow_navigation",
      targetText: "Cancel plan",
      visibleText: "Opens the cancellation review screen",
    })
    expect(
      desktopPolicy(proposed, "https://provider.example", 1280, 720, 0.9)
        .result,
    ).toBe("ALLOW")
    expect(
      desktopPolicy(
        {
          ...proposed,
          visibleText:
            "Opens the cancellation review screen. Effective immediately",
        },
        "https://provider.example",
        1280,
        720,
        0.9,
      ).result,
    ).toBe("INTERCEPT")
  })
  it.each(["Keep cancelling", "Proceed", "No thanks", "Continue", "Next"])(
    "allows reversible %s only with next-step context",
    (targetText) => {
      const proposed = decision({
        type: "cancel_flow_navigation",
        targetText,
        flowStage: "RETENTION",
        visibleText: "Step 1 of 3",
      })
      expect(
        desktopPolicy(proposed, "https://provider.example", 1280, 720, 0.9)
          .result,
      ).toBe("ALLOW")
      expect(
        desktopPolicy(
          { ...proposed, visibleText: "" },
          "https://provider.example",
          1280,
          720,
          0.9,
        ).result,
      ).toBe("INTERCEPT")
    },
  )
  it("requires one-use, immutable policy authorization at the dispatcher", async () => {
    const h = harness()
    const proposed = decision({ type: "click", targetText: "Billing" })
    expect(
      await executeNavigation(h.vm as unknown as DesktopHandle, proposed),
    ).toBe("ACTION_NOT_DISPATCHED")
    const grant = authorizeDesktopNavigation(
      proposed,
      "https://provider.example",
      1280,
      720,
      0.9,
    )!
    expect(Object.isFrozen(grant)).toBe(true)
    expect(
      await executeNavigation(h.vm as unknown as DesktopHandle, { ...grant }),
    ).toBe("ACTION_NOT_DISPATCHED")
    expect(
      await executeNavigation(h.vm as unknown as DesktopHandle, grant),
    ).toBe("NAVIGATION_RETURNED")
    expect(
      await executeNavigation(h.vm as unknown as DesktopHandle, grant),
    ).toBe("ACTION_NOT_DISPATCHED")
    expect(h.vm.mouse.click).toHaveBeenCalledOnce()
    expect(
      authorizeDesktopNavigation(
        decision(),
        "https://provider.example",
        1280,
        720,
        0.9,
      ),
    ).toBeNull()
  })
  it.each(["click", "key"])(
    "auto never retries %s with unknown outcome",
    async (type) => {
      const proposed =
        type === "click"
          ? flow()[1]
          : decision({ type: "key", targetText: null, keys: ["Tab"] })
      const h = harness([proposed])
      const action = type === "click" ? h.vm.mouse.click : h.vm.keyboard.press
      action.mockRejectedValue(new Error("private-sdk-error"))
      const result = await runDesktopDryRun(env, { ...h.deps, auto: true })
      expect(result.stopReason).toBe("ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY")
      expect(action).toHaveBeenCalledOnce()
      expect(h.planner).toHaveBeenCalledOnce()
      expect(result.automaticDestructiveRetries).toBe(0)
    },
  )
  it("auto preserves screen-change guard before dispatch", async () => {
    const h = harness([flow()[1]])
    h.vm.screenshot
      .mockResolvedValueOnce(png())
      .mockResolvedValueOnce(await drift(200, 300))
    const result = await runDesktopDryRun(env, { ...h.deps, auto: true })
    expect(result.stopReason).toBe("SCREEN_CHANGED")
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
  })
  it.each(SAFE_DESKTOP_NAVIGATION_KEYS)(
    "auto dispatches allowlisted %s without confirmation",
    async (key) => {
      const h = harness([
        decision({ type: "key", targetText: null, keys: [key] }),
        flow().at(-1)!,
      ])
      const result = await runDesktopDryRun(env, { ...h.deps, auto: true })
      expect(result.stopReason).toBe("FINAL_ACTION_BOUNDARY")
      expect(h.vm.keyboard.press).toHaveBeenCalledExactlyOnceWith(
        key === "Shift+Tab" ? ["Shift", "Tab"] : [key],
      )
      expect(h.deps.confirm).not.toHaveBeenCalled()
    },
  )
})

describe("private local Desktop viewer", () => {
  it("serves noVNC and memory-only stream settings, rejects other hosts and missing capability", async () => {
    const viewer = await startDesktopViewer(
      "wss://solari.example/private-stream",
      true,
    )
    try {
      const root = await fetch(viewer.url)
      expect(root.status).toBe(200)
      expect(root.headers.get("cache-control")).toBe("no-store")
      expect(await root.text()).not.toContain("private-stream")
      expect(await (await fetch(viewer.url + "session")).json()).toEqual({
        streamUrl: "wss://solari.example/private-stream",
        viewOnly: true,
      })
      expect((await fetch(viewer.url + "novnc/core/rfb.js")).status).toBe(200)
      expect((await fetch(new URL("/session", viewer.url))).status).toBe(404)
      expect(
        (
          await fetch(viewer.url, {
            headers: { Origin: "https://unrelated.example" },
          })
        ).status,
      ).toBe(404)
      const js = await (await fetch(viewer.url + "viewer.js")).text()
      expect(js).toContain("rfb.viewOnly = settings.viewOnly")
      expect(js).toContain("rfb.resizeSession = false")
    } finally {
      await viewer.close()
    }
  })
})
