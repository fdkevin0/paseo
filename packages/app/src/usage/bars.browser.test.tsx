import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
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

it.each([320, 375])(
  "keeps scoped quota rows readable when switching languages at %spx",
  async (width) => {
    await page.viewport(width, 700);
    container.style.width = `${width - 40}px`;
    const scopes = [
      { id: "gemini_models", label: "Gemini" },
      { id: "claude_and_gpt_models", label: "Claude / GPT" },
    ];
    const quotaWindows = scopes.flatMap((scope) => [
      { id: `${scope.id}:five_hour`, label: `${scope.label} · 5-hour`, usedPct: 20 },
      { id: `${scope.id}:weekly`, label: `${scope.label} · Weekly`, usedPct: 95 },
    ]);
    act(() =>
      root.render(
        <>
          {quotaWindows.map((quota) => (
            <UsageWindowBar
              key={quota.id}
              window={quota}
              displayAs="used"
              pinnable={false}
              pinned={false}
              onTogglePin={ignorePin}
              pinLabel=""
              pinTestID=""
            />
          ))}
        </>,
      ),
    );
    expect(container.textContent).toContain("Gemini · 5 hours20% used");
    expect(container.textContent).toContain("Claude / GPT · Weekly95% used");
    await page.screenshot({ path: `/tmp/scoped-usage-rows-${width}-en.png` });
    await act(async () => {
      await i18n.changeLanguage("zh-CN");
    });
    expect(container.textContent).toContain("Gemini · 5小时已使用 20%");
    expect(container.textContent).toContain("Claude / GPT · 每周已使用 95%");
    expect(container.scrollWidth).toBe(container.clientWidth);
    await page.screenshot({ path: `/tmp/scoped-usage-rows-${width}-zh.png` });
  },
);
