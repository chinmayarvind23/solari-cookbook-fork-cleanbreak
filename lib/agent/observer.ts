import type {
  BrowserDecision,
  ObservationAction,
  PageObservation,
} from "@/lib/agent/types"

const ACTION_SELECTOR = "a,button,input,select,textarea"
const OBSERVATION_SCRIPT = String.raw`(() => {
  const compact = (value) => (value || "").replace(/\s+/g, " ").trim();
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" &&
      bounds.width > 0 && bounds.height > 0;
  };
  const accessibleName = (element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledText = labelledBy
      ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
      : "";
    const label = element.labels
      ? Array.from(element.labels).map((item) => item.textContent || "").join(" ")
      : "";
    return compact(element.getAttribute("aria-label") || labelledText || label ||
      element.innerText || element.value || element.getAttribute("placeholder") ||
      element.getAttribute("title"));
  };
  const nodes = Array.from(document.querySelectorAll("a,button,input,select,textarea"));
  return {
    headings: Array.from(document.querySelectorAll("h1,h2,h3"))
      .filter(visible).map((element) => compact(element.textContent))
      .filter(Boolean).slice(0, 12),
    visibleText: compact(document.body.innerText).slice(0, 6000),
    actions: nodes.map((element, domIndex) => {
      const role = element.getAttribute("role") ||
        (element.tagName === "A" ? "link" : element.tagName === "BUTTON" ? "button" :
          element.type === "radio" ? "radio" : element.type === "checkbox" ? "checkbox" :
          element.tagName.toLowerCase());
      return {
        domIndex,
        role,
        name: accessibleName(element),
        kind: element.type || element.tagName.toLowerCase(),
        href: element.getAttribute("href"),
        checked: element.type === "radio" || element.type === "checkbox" ? element.checked : null,
        value: "value" in element ? compact(element.value).slice(0, 200) : null,
        isVisible: visible(element),
        disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true"
      };
    }).filter((item) => item.isVisible && !item.disabled && item.name)
      .slice(0, 60)
      .map(({ isVisible, disabled, ...item }) => item)
  };
})()`

export interface LocatorLike {
  click(): Promise<unknown>
  fill(value: string): Promise<unknown>
  selectOption(value: string): Promise<unknown>
}

export interface AgentPageLike {
  url(): string
  title(): Promise<string>
  evaluate<T>(callback: (() => T) | string): Promise<T>
  locator(selector: string): {
    nth(index: number): LocatorLike
  }
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<unknown>
  waitForURL(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<unknown>
  screenshot(options: { path: string; fullPage: true }): Promise<unknown>
  context(): { storageState(): Promise<unknown> }
}

type RawObservation = {
  headings: string[]
  visibleText: string
  actions: Array<Omit<ObservationAction, "id"> & { domIndex: number }>
}

export type ObservedPage = {
  observation: PageObservation
  targets: Map<string, LocatorLike>
}

export async function observePage(page: AgentPageLike): Promise<ObservedPage> {
  const [title, raw] = await Promise.all([
    page.title(),
    page.evaluate<RawObservation>(OBSERVATION_SCRIPT),
  ])

  const id = crypto.randomUUID()
  const targets = new Map<string, LocatorLike>()
  const actions = raw.actions.map(({ domIndex, ...action }, index) => {
    const targetId = `el_${index + 1}`
    targets.set(targetId, page.locator(ACTION_SELECTOR).nth(domIndex))
    return { id: targetId, ...action }
  })
  return {
    observation: {
      id,
      observedAt: new Date().toISOString(),
      url: page.url(),
      title: title.slice(0, 300),
      headings: raw.headings,
      visibleText: raw.visibleText,
      actions,
    },
    targets,
  }
}

export async function executeDecision(
  page: AgentPageLike,
  observed: ObservedPage,
  decision: BrowserDecision,
  navigationTimeoutMs: number,
): Promise<void> {
  if (decision.type === "navigate") {
    await page.goto(decision.url!, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    })
    return
  }
  const target = observed.targets.get(decision.targetId!)
  if (!target) throw new Error("The observation target is stale.")
  const targetMetadata = observed.observation.actions.find(
    (action) => action.id === decision.targetId,
  )
  if (decision.type === "fill") await target.fill(decision.value!)
  else if (decision.type === "select")
    await target.selectOption(decision.value!)
  else if (targetMetadata?.href) {
    await Promise.all([
      page.waitForURL(
        new URL(targetMetadata.href, observed.observation.url).toString(),
        {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeoutMs,
        },
      ),
      target.click(),
    ])
  } else await target.click()
}
