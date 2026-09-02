"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { isDemoScenario } from "@/lib/demo"
import { confirmDemoCancellation, resetDemo } from "@/lib/db"
import { runCancellationAgent } from "@/lib/agent/runtime"
import { runLiveSolariSmoke } from "@/lib/solari/runtime"

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
