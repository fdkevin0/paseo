import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { builtinSidebarNavLabelKey } from "@/sidebar-nav/model";
import { useUsageDisplay } from "./display";
import { useUsageInSidebar } from "./in-sidebar";
import { useUsageHostId } from "./hosts";
import { useUsageHostReports } from "./queries";
import { UsageSourceIcon } from "./source-icon";
import { UsageMeter } from "./meter";
import {
  choosePinnedUsageLayout,
  METER_GAP,
  MIN_METER_WIDTH,
  resolvePinnedUsage,
  type PinnedUsageLayout,
  type PinnedUsageSource,
} from "./pinned";
import { UsageModal } from "./usage-modal";

/** Each summary window with data on the usage host, under its source; empty while none has. */
export function useUsageSummary(): readonly PinnedUsageSource[] {
  const { t } = useTranslation();
  const { inSidebar } = useUsageInSidebar();
  const serverId = useUsageHostId();
  const reports = useUsageHostReports(inSidebar ? serverId : null);
  const { preferences } = useUsageDisplay(reports);
  return useMemo(() => resolvePinnedUsage(reports, preferences, t), [preferences, reports, t]);
}

/**
 * The sidebar footer's usage entry: each summary window's source icon and percent, and nothing
 * while no summary window has data, since the footer's Usage icon already opens Usage.
 * Pressing it opens the Usage modal.
 */
export function UsageSidebarItem({ sources }: { sources: readonly PinnedUsageSource[] }) {
  const { t } = useTranslation();
  const label = t(builtinSidebarNavLabelKey("usage"));
  const openUsage = useOpenSidebarUsage();
  if (sources.length === 0) return null;
  return <PinnedUsageTrigger label={label} sources={sources} onPress={openUsage} />;
}

const OpenSidebarUsageContext = createContext<(() => void) | null>(null);

/**
 * One owner for the footer icon and summary: both open the Usage modal over the current screen.
 * The modal mounts on first open and unmounts once it has finished closing, so its host's reports
 * load only while it is shown.
 */
export function UsageSidebarRoot({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const openUsage = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);
  const closeUsage = useCallback(() => setOpen(false), []);
  const unmountUsage = useCallback(() => setMounted(false), []);

  return (
    <OpenSidebarUsageContext.Provider value={openUsage}>
      {children}
      {mounted ? <UsageModal visible={open} onClose={closeUsage} onDismiss={unmountUsage} /> : null}
    </OpenSidebarUsageContext.Provider>
  );
}

/** Both sidebar entry points send the same open command. */
export function useOpenSidebarUsage(): () => void {
  const openUsage = useContext(OpenSidebarUsageContext);
  if (!openUsage) throw new Error("Sidebar Usage must be inside UsageSidebarRoot.");
  return openUsage;
}

function pinnedUsageLabel(label: string, sources: readonly PinnedUsageSource[]): string {
  const windows = sources.flatMap((source) => source.windows);
  return `${label}: ${windows.map((window) => window.label).join(", ")}`;
}

function triggerStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return hovered ? [styles.trigger, styles.triggerHovered] : styles.trigger;
}

function layoutWidth(event: LayoutChangeEvent): number {
  return event.nativeEvent.layout.width;
}

function PinnedUsageTrigger({
  label,
  sources,
  onPress,
}: {
  label: string;
  sources: readonly PinnedUsageSource[];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={pinnedUsageLabel(label, sources)}
      style={triggerStyle}
      testID="sidebar-usage"
    >
      {sources.map((source) => (
        <PinnedUsageAccount key={source.key} source={source} />
      ))}
    </Pressable>
  );
}

function PinnedUsageAccount({ source }: { source: PinnedUsageSource }) {
  const [available, setAvailable] = useState<number | null>(null);
  const [labelsWidth, setLabelsWidth] = useState<number | null>(null);
  const handleAvailableLayout = useCallback((event: LayoutChangeEvent) => {
    const width = layoutWidth(event);
    if (width > 0) setAvailable(width);
  }, []);
  const handleLabelsLayout = useCallback((event: LayoutChangeEvent) => {
    const width = layoutWidth(event);
    if (width > 0) setLabelsWidth(width);
  }, []);
  const layout = choosePinnedUsageLayout({
    available,
    labelsWidth,
    windowCount: source.windows.length,
  });
  return (
    <View style={styles.source} testID="sidebar-usage-source">
      <UsageSourceIcon svg={source.icon} size={14} />
      <View style={styles.sourceContent}>
        <Text style={styles.sourceLabel} testID="sidebar-usage-source-label">
          {source.label}
        </Text>
        <View
          style={[styles.windows, layout === "labels" && styles.wrapped]}
          onLayout={handleAvailableLayout}
        >
          <PinnedUsageWindows source={source} layout={layout} />
        </View>
      </View>
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <View style={styles.measured} onLayout={handleLabelsLayout}>
          <PinnedUsageWindows source={source} layout="labels" measuring />
        </View>
      </View>
    </View>
  );
}

function PinnedUsageWindows({
  source,
  layout,
  measuring = false,
}: {
  source: PinnedUsageSource;
  layout: PinnedUsageLayout;
  measuring?: boolean;
}) {
  return source.windows.map((window) => (
    <View key={window.key} style={[styles.window, layout === "meters" && styles.windowWithMeter]}>
      {layout === "meters" ? (
        <View style={styles.meterSlot} testID="sidebar-usage-meter">
          <UsageMeter percent={window.percent} tone={window.tone} quiet />
        </View>
      ) : null}
      <Text style={styles.percent} testID={measuring ? undefined : "sidebar-usage-pinned-window"}>
        {window.percentText}
        {window.shortLabel === "" ? null : (
          <Text style={styles.windowLabel}>{` ${window.shortLabel}`}</Text>
        )}
      </Text>
    </View>
  ));
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: "100%",
    gap: theme.spacing[1],
    overflow: "hidden",
    // Same row geometry and leading rail as Add project and the footer icons.
    minHeight: 28,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  source: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  sourceContent: {
    flex: 1,
    minWidth: 0,
  },
  sourceLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  windows: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: theme.spacing[2],
    rowGap: theme.spacing[1],
  },
  wrapped: {
    flexWrap: "wrap",
  },
  window: {
    flexDirection: "row",
    alignItems: "center",
    gap: METER_GAP,
    maxWidth: "100%",
  },
  windowWithMeter: {
    flexGrow: 1,
  },
  // Wide enough that nothing inside wraps or shrinks; each child reports its natural width.
  measure: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 10_000,
    opacity: 0,
  },
  measured: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  meterSlot: {
    flexGrow: 1,
    minWidth: MIN_METER_WIDTH,
  },
  percent: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  windowLabel: {
    color: theme.colors.foregroundMuted,
  },
}));
