import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { UsageSidebarItem, UsageSidebarRoot } from "./sidebar-item";
import { resolvePinnedUsage } from "./pinned";
import { DEFAULT_USAGE_PREFERENCES, type UsagePreferences } from "./preferences";
import type { UsageReportEntry } from "./types";
import { i18n } from "@/i18n/i18next";
import { UsageWindowBar } from "./window-bar";
import type { UsageBalance, UsageWindow } from "./types";
import { UsageBalanceBar } from "./balance-bar";

const window: UsageWindow = { id: "session", label: "Session", usedPct: 70 };
const balance: UsageBalance = { id: "credits", label: "Credits", unit: "usd", remaining: 12 };
const ignorePin = () => {};

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await i18n.changeLanguage("en");
  vi.unstubAllGlobals();
});

it("translates mounted usage rows when the language changes", async () => {
  act(() =>
    root.render(
      <>
        <UsageWindowBar
          window={window}
          displayAs="used"
          pinnable={false}
          pinned={false}
          onTogglePin={ignorePin}
          pinLabel=""
          pinTestID=""
        />
        <UsageBalanceBar balance={balance} />
      </>,
    ),
  );
  expect(container.textContent).toContain("Session70% used");
  expect(container.textContent).toContain("Credits");
  await act(async () => {
    await i18n.changeLanguage("ja");
  });
  expect(container.textContent).toContain("セッション70% 使用済み");
  expect(container.textContent).toContain("クレジット");
});

// These imports belong to the unopened modal/data-query path, not the rendered sidebar.
vi.mock("./usage-modal", () => ({ UsageModal: () => null }));
vi.mock("./queries", () => ({
  useUsageHostReports: () => {
    throw new Error("Unexpected usage query");
  },
}));
vi.mock("./display", () => ({
  useUsageDisplay: () => {
    throw new Error("Unexpected usage display hook");
  },
}));
vi.mock("./hosts", () => ({
  useUsageHostId: () => {
    throw new Error("Unexpected usage host hook");
  },
}));
vi.mock("./in-sidebar", () => ({
  useUsageInSidebar: () => {
    throw new Error("Unexpected usage sidebar hook");
  },
}));
// Keep the fixture source icon's real 14px footprint; the repository SVG stub renders null.
vi.mock("lucide-react-native", async (original) => ({ ...(await original()), Gauge: () => null }));
vi.mock("react-native-svg", async (original) => ({
  ...(await original()),
  SvgXml: ({ width, height }: { width: number; height: number }) => (
    <svg width={width} height={height} viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6" fill="black" />
    </svg>
  ),
}));

const quotaLabels: Record<string, string> = {
  five_hour: "5-hour",
  weekly: "Weekly",
  "gemini:five_hour": "Gemini · 5-hour",
  "gemini:weekly": "Gemini · Weekly",
  "claude_gpt:five_hour": "Claude / GPT · 5-hour",
  "claude_gpt:weekly": "Claude / GPT · Weekly",
};
const quota = (id: string, shortLabel: string, usedPct: number): UsageWindow => ({
  id,
  label: quotaLabels[id] ?? shortLabel,
  shortLabel,
  usedPct,
  summary: true,
});
function account(
  sourceId: string,
  sourceLabel: string,
  label: string,
  windows: UsageWindow[],
): UsageReportEntry {
  return {
    id: `${sourceId}:${label}`,
    sourceId,
    sourceLabel,
    account: { label },
    icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
    fetchedAt: "2026-11-11T00:00:00Z",
    report: { status: "available", windows },
  };
}
function sidebarReports(): UsageReportEntry[] {
  return [
    account("codex", "Codex", "Work", [quota("five_hour", "5h", 7), quota("weekly", "wk", 12)]),
    account("agy", "Antigravity", "Main", [
      quota("gemini:five_hour", "Gemini 5h", 20),
      quota("gemini:weekly", "Gemini wk", 65),
      quota("claude_gpt:five_hour", "Claude / GPT 5h", 41),
      quota("claude_gpt:weekly", "Claude / GPT wk", 83),
    ]),
    account("agy", "Antigravity", "Team", [
      quota("gemini:five_hour", "Gemini 5h", 13),
      quota("gemini:weekly", "Gemini wk", 57),
      quota("claude_gpt:five_hour", "Claude / GPT 5h", 38),
      quota("claude_gpt:weekly", "Claude / GPT wk", 91),
    ]),
    account("custom", "Future", "Research", [
      quota("unknown", "UnknownAllowanceWithoutAnyWordBoundary".repeat(4), 29),
    ]),
  ];
}
async function renderSidebar(
  reports: UsageReportEntry[],
  preferences: UsagePreferences = DEFAULT_USAGE_PREFERENCES,
) {
  const sources = resolvePinnedUsage(reports, preferences);
  await act(async () =>
    root.render(
      <UsageSidebarRoot>
        <UsageSidebarItem sources={sources} />
      </UsageSidebarRoot>,
    ),
  );
  await expect
    .poll(() => container.querySelectorAll('[data-testid="sidebar-usage-pinned-window"]').length)
    .toBe(sources.flatMap((s) => s.windows).length);
  return sources;
}
function expectCompleteSidebar(sources: ReturnType<typeof resolvePinnedUsage>) {
  const trigger = container.querySelector('[data-testid="sidebar-usage"]');
  if (!(trigger instanceof HTMLElement)) throw new Error("Missing sidebar button");
  const shown = [...container.querySelectorAll('[data-testid="sidebar-usage-pinned-window"]')];
  const expected = sources.flatMap((s) => s.windows);
  expect(shown.map((e) => e.textContent)).toEqual(
    expected.map((w) => `${w.percentText}${w.shortLabel ? ` ${w.shortLabel}` : ""}`),
  );
  const bounds = trigger.getBoundingClientRect();
  for (const element of shown) {
    const box = element.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(bounds.right + 1);
    expect(box.left).toBeGreaterThanOrEqual(bounds.left);
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
  }
  const descriptions = trigger.getAttribute("aria-label");
  for (const w of expected) expect(descriptions).toContain(w.label);
  expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  return trigger;
}

it("keeps all scoped quota labels at 240px", async () => {
  await page.viewport(800, 600);
  container.style.width = "240px";
  const sources = await renderSidebar(sidebarReports().slice(0, 2));
  await page.screenshot({ element: container, path: "/tmp/usage-sidebar-identities-240-en.png" });
  expectCompleteSidebar(sources);
  await expect
    .poll(
      () =>
        container
          .querySelector('[data-testid="sidebar-usage-source"]')
          ?.querySelectorAll('[data-testid="sidebar-usage-meter"]').length,
    )
    .toBe(2);
});

const sidebarCases = [220, 240, 320, 400].flatMap((width) =>
  ["en", "zh-CN"].flatMap((language) =>
    [14, 22].map((fontSize) => ({ width, language, fontSize })),
  ),
);
it.each(sidebarCases)(
  "preserves every pin at $width px in $language with $fontSize px text",
  async ({ width, language, fontSize }) => {
    await page.viewport(800, 600);
    container.id = "usage-sidebar-fixture";
    container.style.width = `${width}px`;
    const font = document.createElement("style");
    font.textContent = `#usage-sidebar-fixture [dir="auto"] { font-size:${fontSize}px !important; }`;
    document.head.appendChild(font);
    try {
      await act(async () => {
        await i18n.changeLanguage(language);
      });
      for (const reports of [
        sidebarReports().slice(0, 1),
        sidebarReports().slice(0, 2),
        sidebarReports(),
      ]) {
        const sources = await renderSidebar(reports);
        await expect
          .poll(
            () =>
              container.querySelector('[data-testid="sidebar-usage-pinned-window"]')?.textContent,
          )
          .toContain(sources[0].windows[0].shortLabel);
        expectCompleteSidebar(sources);
        const first = container.querySelector('[data-testid="sidebar-usage-pinned-window"]');
        if (!first) throw new Error("Missing quota text");
        expect(Number.parseFloat(getComputedStyle(first).fontSize)).toBe(fontSize);
        expect(
          [...container.querySelectorAll('[data-testid="sidebar-usage-source-label"]')].map(
            (e) => e.textContent,
          ),
        ).toEqual(reports.map((r) => `${r.sourceLabel} (${r.account.label})`));
        if (width === 240 && language === "en" && fontSize === 14 && reports.length === 4)
          await page.screenshot({
            element: container,
            path: "/tmp/usage-sidebar-identities-240-en-accounts.png",
          });
        if (width === 220 && language === "zh-CN" && fontSize === 22 && reports.length === 2)
          await page.screenshot({
            element: container,
            path: "/tmp/usage-sidebar-identities-220-zh-large.png",
          });
      }
    } finally {
      font.remove();
    }
  },
);

it("preserves explicit pins across accounts and one keyboard target", async () => {
  container.style.width = "220px";
  const selected: UsagePreferences = {
    ...DEFAULT_USAGE_PREFERENCES,
    pins: [
      { sourceId: "codex", windowId: "weekly" },
      { sourceId: "agy", windowId: "gemini:weekly" },
      { sourceId: "custom", windowId: "unknown" },
    ],
  };
  const original = structuredClone(selected);
  const sources = await renderSidebar(sidebarReports(), selected);
  const trigger = expectCompleteSidebar(sources);
  expect(sources.flatMap((s) => s.windows).map((w) => w.percent)).toEqual([12, 65, 57, 29]);
  expect(selected).toEqual(original);
  await userEvent.tab();
  expect(document.activeElement).toBe(trigger);
  await userEvent.tab();
  expect(container.contains(document.activeElement)).toBe(false);
});
