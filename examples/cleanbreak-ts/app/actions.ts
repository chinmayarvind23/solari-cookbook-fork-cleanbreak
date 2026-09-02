"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { isDemoScenario } from "@/lib/demo"
import { confirmDemoCancellation, resetDemo } from "@/lib/db"

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
