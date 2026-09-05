"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { isDemoScenario } from "@/lib/demo"
import { confirmDemoCancellation, resetDemo } from "@/lib/db"
import { runCancellationAgent } from "@/lib/agent/runtime"
import { abortCancellation, approveCancellation } from "@/lib/agent/commit"
import { runLiveSolariSmoke } from "@/lib/solari/runtime"
import { runIndependentVerification } from "@/lib/verification/runtime"
import { cancellationRepository } from "@/lib/cancellations/repository"

function safeReturnPath(value: FormDataEntryValue | null): string {
  return typeof value === "string" && value.startsWith("/")
    ? value
    : "/demo/streammax/account"
}

export async function resetDemoAction(formData: FormData): Promise<void> {
  const scenario = formData.get("scenario")

  if (!isDemoScenario(scenario)) {
    throw new Error("Unknown demo scenario")
  }

  resetDemo(scenario)
  cancellationRepository().resetFixtureLocks()
  revalidatePath("/")
  revalidatePath("/demo", "layout")
  redirect(safeReturnPath(formData.get("returnTo")))
}

export async function confirmDemoCancellationAction(): Promise<void> {
  confirmDemoCancellation()
  revalidatePath("/")
  revalidatePath("/demo", "layout")
  redirect("/demo/streammax/result")
}

export async function runSolariBrowserTestAction(): Promise<void> {
  try {
    await runLiveSolariSmoke()
    revalidatePath("/demo")
    redirect("/demo#solari-run")
  } catch (error) {
    if (typeof error === "object" && error !== null && "digest" in error) {
      throw error
    }
    redirect("/demo?solari=configuration#solari-run")
  }
}

export async function runAgentDryRunAction(): Promise<void> {
  try {
    await runCancellationAgent()
    revalidatePath("/demo")
    redirect("/demo#agent-run")
  } catch (error) {
    if (typeof error === "object" && error !== null && "digest" in error) {
      throw error
    }
    redirect("/demo?agent=configuration#agent-run")
  }
}

function approvalField(
  formData: FormData,
  name: "jobId" | "fingerprint",
): string {
  const value = formData.get(name)
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing approval ${name}.`)
  }
  return value
}

export async function approveCancellationAction(
  formData: FormData,
): Promise<void> {
  if (formData.get("intent") !== "approve") {
    throw new Error("Invalid approval intent.")
  }
  try {
    const committed = await approveCancellation(
      approvalField(formData, "jobId"),
      approvalField(formData, "fingerprint"),
    )
    if (committed.state === "VERIFYING") {
      await runIndependentVerification(committed.id)
    }
    revalidatePath("/demo")
    redirect("/demo#agent-run")
  } catch (error) {
    if (typeof error === "object" && error !== null && "digest" in error) {
      throw error
    }
    revalidatePath("/demo")
    redirect("/demo?agent=approval-blocked#agent-run")
  }
}

export async function runVerificationAction(formData: FormData): Promise<void> {
  const jobId = approvalField(formData, "jobId")
  await runIndependentVerification(jobId)
  revalidatePath("/")
  revalidatePath("/demo")
  redirect("/demo#agent-run")
}

export async function abortCancellationAction(
  formData: FormData,
): Promise<void> {
  if (formData.get("intent") !== "abort") {
    throw new Error("Invalid abort intent.")
  }
  abortCancellation(
    approvalField(formData, "jobId"),
    approvalField(formData, "fingerprint"),
  )
  revalidatePath("/demo")
  redirect("/demo#agent-run")
}
