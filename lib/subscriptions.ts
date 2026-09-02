export type SubscriptionInterval = "MONTHLY" | "YEARLY"
export type SubscriptionStatus = "ACTIVE" | "CANCELED"

export type Subscription = {
  id: string
  name: string
  slug: string
  url: string
  domain: string
  amount: number
  currency: string
  interval: SubscriptionInterval
  nextRenewalDate?: string
  status: SubscriptionStatus
  createdAt: string
  updatedAt: string
}

export function annualCost(
  amount: number,
  interval: SubscriptionInterval,
): number {
  return interval === "MONTHLY" ? amount * 12 : amount
}

export function monthlyEquivalent(subscription: Subscription): number {
  return subscription.interval === "MONTHLY"
    ? subscription.amount
    : subscription.amount / 12
}

export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}
