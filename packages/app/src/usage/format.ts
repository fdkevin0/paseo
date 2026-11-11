import type { TFunction } from "i18next";
import { i18n } from "@/i18n/i18next";
import { formatTimeOfDay } from "@/utils/time";
import type { UsageDisplayAs } from "./preferences";
import type { UsageBalanceUnit, UsageWindow } from "./types";

const providerUsageLabels = {
  session: { label: "Session", key: "providerUsage.labels.session" },
  weekly: { label: "Weekly", key: "providerUsage.labels.weekly" },
  monthly: { label: "Monthly", key: "providerUsage.labels.monthly" },
  code_review: { label: "Code review", key: "providerUsage.labels.codeReview" },
  credits: { label: "Credits", key: "providerUsage.labels.credits" },
  monthly_credits: { label: "Monthly credits", key: "providerUsage.labels.monthlyCredits" },
} as const;

// shortcut: the SDK flattens scope/period into names; replace this boundary when structured metadata is available.
function reportedUsageLabels(id: string, label: string, t: TFunction) {
  const scopeEnd = id.lastIndexOf(":");
  const labelScopeEnd = label.lastIndexOf(" · ");
  const scoped = scopeEnd > 0 && labelScopeEnd > 0;
  const periodId = scoped ? id.slice(scopeEnd + 1) : id;
  const periodLabel = scoped ? label.slice(labelScopeEnd + 3) : label;
  const scopeLabel = scoped ? label.slice(0, labelScopeEnd) : "";
  let translatedScope = scopeLabel;
  if (id.slice(0, scopeEnd) === "code_review" && scopeLabel === "Code review") {
    translatedScope = t("providerUsage.labels.codeReview");
  }

  let canonicalLabel: string;
  let canonicalShortLabel: string;
  let translatedLabel: string;
  let translatedShortLabel: string;
  if (periodId === "weekly") {
    canonicalLabel = "Weekly";
    canonicalShortLabel = "wk";
    translatedLabel = t("providerUsage.labels.weekly");
    translatedShortLabel = t("providerUsage.labels.weeklyShort");
  } else {
    let seconds = 18000;
    if (periodId !== "five_hour") {
      seconds = Number(periodId.slice(0, -1));
      const canonicalId = `${seconds}s`;
      if (periodId !== canonicalId || seconds === 18000 || seconds === 604800) return null;
    }
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const units = [
      [86400, "day", "d"],
      [3600, "hour", "h"],
      [60, "minute", "m"],
      [1, "second", "s"],
    ] as const;
    const [size, unit, shortUnit] =
      units.find(([unitSeconds]) => seconds % unitSeconds === 0) ?? units[3];
    const amount = seconds / size;
    canonicalLabel = `${amount}-${unit}`;
    canonicalShortLabel = `${amount}${shortUnit}`;
    translatedLabel = new Intl.NumberFormat(i18n.resolvedLanguage, {
      style: "unit",
      unit,
      unitDisplay: "long",
      maximumSignificantDigits: 21,
    }).format(amount);
    translatedShortLabel = new Intl.NumberFormat(i18n.resolvedLanguage, {
      style: "unit",
      unit,
      unitDisplay: "narrow",
      maximumSignificantDigits: 21,
    }).format(amount);
  }
  if (periodLabel !== canonicalLabel) return null;
  if (scoped) {
    return {
      label: `${translatedScope} · ${translatedLabel}`,
      shortLabel: `${translatedScope} ${translatedShortLabel}`,
      canonicalShortLabel: `${scopeLabel} ${canonicalShortLabel}`,
    };
  }
  return { label: translatedLabel, shortLabel: translatedShortLabel, canonicalShortLabel };
}

export function formatProviderUsageShortLabel(window: UsageWindow, t: TFunction = i18n.t): string {
  if (window.shortLabel === undefined) return formatProviderUsageLabel(window.id, window.label, t);
  const reported = reportedUsageLabels(window.id, window.label, t);
  if (reported && window.shortLabel === reported.canonicalShortLabel) return reported.shortLabel;
  return window.shortLabel;
}

export function formatProviderUsageLabel(id: string, label: string, t: TFunction = i18n.t): string {
  const reported = reportedUsageLabels(id, label, t);
  if (reported) return reported.label;
  const reviewPrefix = "Code review · ";
  if (id.startsWith("code_review:") && label.startsWith(reviewPrefix)) {
    const periodId = id.slice("code_review:".length);
    const periodLabel = label.slice(reviewPrefix.length);
    return `${t(providerUsageLabels.code_review.key)} · ${formatProviderUsageLabel(periodId, periodLabel, t)}`;
  }
  const standard =
    providerUsageLabels[id as keyof typeof providerUsageLabels] ??
    (id === "five_hour" ? providerUsageLabels.session : undefined);
  return standard?.label === label ? t(standard.key) : label;
}

export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function formatPct(value: number, locale?: string): string {
  const resolvedLocale = locale ?? i18n.resolvedLanguage;
  return new Intl.NumberFormat(resolvedLocale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(clampPct(value) / 100);
}

/** A localized percentage that says whether it is used or remaining. */
export function formatDisplayPct(
  value: number,
  displayAs: UsageDisplayAs,
  locale?: string,
  t: TFunction = i18n.t,
): string {
  const percentage = formatPct(value, locale);
  return displayAs === "used"
    ? t("providerUsage.values.used", { percentage })
    : t("providerUsage.values.remaining", { amount: percentage });
}

type DurationUnit = "minutes" | "hours" | "days";
interface DurationPart {
  unit: DurationUnit;
  count: number;
}
/** Two units, floored, so a countdown keeps moving: "2d 23h", "4h 59m", "37m". */
type RelativeDuration = { kind: "now" } | { kind: "remaining"; parts: DurationPart[] };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function formatCount(value: number): string {
  return new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
}

function relativeDuration(iso: string, now: number): RelativeDuration | null {
  const diffMs = new Date(iso).getTime() - now;
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs <= 0) return { kind: "now" };
  const days = Math.floor(diffMs / DAY_MS);
  const hours = Math.floor((diffMs % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((diffMs % HOUR_MS) / MINUTE_MS);
  if (days > 0) return remaining({ unit: "days", count: days }, { unit: "hours", count: hours });
  if (hours > 0)
    return remaining({ unit: "hours", count: hours }, { unit: "minutes", count: minutes });
  return remaining({ unit: "minutes", count: minutes });
}

/** The major unit, plus the minor one unless it is zero. */
function remaining(major: DurationPart, minor?: DurationPart): RelativeDuration {
  return { kind: "remaining", parts: minor && minor.count > 0 ? [major, minor] : [major] };
}

function formatDurationPart(part: DurationPart, t: TFunction): string {
  return t(`providerUsage.duration.${part.unit}`, {
    count: part.count,
    value: formatCount(part.count),
  });
}

function formatRelativeDuration(
  duration: Extract<RelativeDuration, { kind: "remaining" }>,
  t: TFunction,
): string {
  const [first, second] = duration.parts.map((part) => formatDurationPart(part, t));
  return second ? t("providerUsage.duration.pair", { first, second }) : first;
}

export function formatResetLabel(
  iso: string | null | undefined,
  retained = false,
  now = Date.now(),
  t: TFunction = i18n.t,
): string | null {
  if (!iso) return null;
  const rel = relativeDuration(iso, now);
  if (!rel) return null;
  if (rel.kind === "now" && retained) return t("providerUsage.timing.resetTimePassed");
  if (rel.kind === "now") return t("providerUsage.timing.resettingNow");
  return t("providerUsage.timing.resetsIn", { duration: formatRelativeDuration(rel, t) });
}

/**
 * When a window resets on the clock: "3:00 PM" within a day, "Fri 3:00 PM" within a week,
 * "Oct 31, 3:00 PM" after that. Names follow the app language; 12/24h follows the device.
 * Nothing for a time that has passed, where the countdown already says so.
 */
export function formatResetTime(
  iso: string | null | undefined,
  now = Date.now(),
  t: TFunction = i18n.t,
): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  const diffMs = at.getTime() - now;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return null;
  const time = formatTimeOfDay(at);
  const locale = i18n.resolvedLanguage;
  if (diffMs < DAY_MS) return time;
  if (diffMs < 7 * DAY_MS) {
    const weekday = at.toLocaleDateString(locale, { weekday: "short" });
    return t("providerUsage.timing.resetsAtWeekday", { weekday, time });
  }
  const date = at.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return t("providerUsage.timing.resetsAtDate", { date, time });
}

export function formatRunsOutLabel(
  iso: string | null | undefined,
  now = Date.now(),
  t: TFunction = i18n.t,
): string | null {
  if (!iso) return null;
  const rel = relativeDuration(iso, now);
  if (!rel) return null;
  if (rel.kind === "now") return t("providerUsage.timing.runsOutNow");
  return t("providerUsage.timing.runsOutIn", { duration: formatRelativeDuration(rel, t) });
}

export function formatAgo(
  iso: string | null | undefined,
  now = Date.now(),
  t: TFunction = i18n.t,
): string | null {
  if (!iso) return null;
  const diffMs = now - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs < 60_000) return t("providerUsage.timing.justNow");
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) {
    return t("providerUsage.timing.daysAgo", {
      count: diffDays,
      value: formatCount(diffDays),
    });
  }
  if (diffHours > 0) {
    return t("providerUsage.timing.hoursAgo", {
      count: diffHours,
      value: formatCount(diffHours),
    });
  }
  return t("providerUsage.timing.minutesAgo", {
    count: diffMinutes,
    value: formatCount(diffMinutes),
  });
}

/** A balance amount as the app's language writes it: "$1,234.50", "12,345". */
export function formatAmount(value: number, unit: UsageBalanceUnit, locale?: string): string {
  switch (unit) {
    case "usd":
      return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(value);
    case "tokens":
      return new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
    default:
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  }
}
