import type { PluginTheme } from "@getpaseo/plugin";
import { Platform, type TextStyle, type ViewStyle } from "react-native";

// Mirrors packages/app/src/styles/theme.ts SPACING/FONT_SIZE/BORDER_RADIUS/FONT_WEIGHT —
// the plugin runtime only exposes PluginTheme.colors, not the token objects themselves,
// so the scale is reproduced here to stay on the same rhythm as the host app.
export const SPACE = { 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24 } as const;
export const FONT_SIZE = { sm: 12, base: 14 } as const;
export const FONT_WEIGHT = { normal: "normal", medium: "500", semibold: "600" } as const;
export const RADIUS = { md: 6, lg: 8, full: 9999 } as const;
export const CONTROL_HEIGHT_SM = 32;
export const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
// One indent step per epic level in the grouped tree view.
export const TREE_INDENT = SPACE[3];

export type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

// Web-only hover tooltip. react-native-web forwards `title` to the DOM node; native RN
// ignores the extra prop. `accessibilityLabel` covers screen readers on every platform.
export function hoverTitle(text: string): Record<string, unknown> {
  return Platform.OS === "web" ? { title: text } : {};
}

interface ChipStyles {
  base: ViewStyle;
  selected: ViewStyle;
  text: TextStyle;
  textSelected: TextStyle;
}

interface ButtonVariantStyles {
  base: ViewStyle;
  text: TextStyle;
}

export interface PanelStyles {
  screen: ViewStyle;
  footerCount: TextStyle;
  toolbar: ViewStyle;
  searchWrap: ViewStyle;
  searchIcon: ViewStyle;
  searchInput: TextStyle;
  detail: TextStyle;
  errorBanner: ViewStyle;
  errorBannerText: TextStyle;
  table: ViewStyle;
  headerRow: ViewStyle;
  headerCell: ViewStyle;
  headerCellText: TextStyle;
  row: ViewStyle;
  rowBordered: ViewStyle;
  rowSelected: ViewStyle;
  groupHeaderRow: ViewStyle;
  cellText: TextStyle;
  cellTextMuted: TextStyle;
  cellId: TextStyle;
  dotRow: ViewStyle;
  statusDot: ViewStyle;
  groupToggle: ViewStyle;
  skeletonBar: ViewStyle;
  filterChipRow: ViewStyle;
  filterChip: ViewStyle;
  filterChipText: TextStyle;
  panel: ViewStyle;
  panelBordered: ViewStyle;
  panelBody: ViewStyle;
  panelHeaderRow: ViewStyle;
  panelHeaderText: TextStyle;
  iconButton: ViewStyle;
  sectionLabel: TextStyle;
  sectionRow: ViewStyle;
  linkGroup: ViewStyle;
  linkItem: ViewStyle;
  linkDot: ViewStyle;
  linkItemId: TextStyle;
  linkItemTitle: TextStyle;
  metaText: TextStyle;
  linkAction: TextStyle;
  fieldLabel: TextStyle;
  fieldInput: TextStyle;
  fieldInputMultiline: TextStyle;
  markdownPreview: ViewStyle;
  actionRow: ViewStyle;
  buttonDisabled: ViewStyle;
  tone: Record<Tone, TextStyle>;
  chip: ChipStyles;
  button: Record<"primary" | "secondary" | "ghost" | "destructive", ButtonVariantStyles>;
}

export function buildStyles(theme: PluginTheme, compact: boolean): PanelStyles {
  const colors = theme.colors;
  return {
    screen: { flex: 1, padding: compact ? SPACE[3] : SPACE[4], backgroundColor: colors.surface0, gap: SPACE[3] },
    footerCount: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm, paddingHorizontal: SPACE[1] },
    toolbar: { flexDirection: "row", alignItems: "center", gap: SPACE[2] },
    searchWrap: { flex: 1, justifyContent: "center" },
    searchIcon: { position: "absolute", left: SPACE[2], zIndex: 1 },
    searchInput: {
      height: CONTROL_HEIGHT_SM,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADIUS.lg,
      paddingLeft: SPACE[6],
      paddingRight: SPACE[2],
      color: colors.foreground,
      fontSize: FONT_SIZE.base,
      backgroundColor: colors.surface1,
      outlineWidth: 0,
    },
    detail: { color: colors.foregroundMuted, fontSize: FONT_SIZE.base },
    errorBanner: {
      borderWidth: 1,
      borderColor: colors.statusDanger,
      borderRadius: RADIUS.lg,
      padding: SPACE[3],
      backgroundColor: colors.surface1,
      gap: SPACE[2],
    },
    errorBannerText: { color: colors.statusDanger, fontSize: FONT_SIZE.sm },
    table: { borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS.lg, overflow: "hidden" },
    headerRow: {
      flexDirection: "row",
      paddingVertical: SPACE[2],
      paddingHorizontal: SPACE[3],
      // Matches the row's always-present 2px accent gutter so header and body columns align.
      borderLeftWidth: 2,
      borderLeftColor: "transparent",
      backgroundColor: colors.surface1,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerCell: { flexDirection: "row", alignItems: "center", gap: SPACE[1] },
    headerCellText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold },
    row: {
      flexDirection: "row",
      paddingVertical: SPACE[2] + 2,
      paddingHorizontal: SPACE[3],
      alignItems: "center",
      backgroundColor: colors.surface0,
      // Reserved on every row so selecting one only recolours the gutter — no content shift.
      borderLeftWidth: 2,
      borderLeftColor: "transparent",
    },
    rowBordered: { borderTopWidth: 1, borderTopColor: colors.border },
    rowSelected: { backgroundColor: colors.surface2, borderLeftColor: colors.accent },
    groupHeaderRow: { backgroundColor: colors.surface1 },
    cellText: { color: colors.foreground, fontSize: FONT_SIZE.base },
    cellTextMuted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm },
    cellId: {
      color: colors.foregroundMuted,
      fontSize: FONT_SIZE.sm,
      fontFamily: MONO_FONT,
    },
    dotRow: { flexDirection: "row", alignItems: "center", gap: SPACE[1.5] },
    statusDot: { width: 6, height: 6, borderRadius: RADIUS.full },
    groupToggle: { width: 18, alignItems: "center", justifyContent: "center" },
    skeletonBar: { height: 10, borderRadius: RADIUS.md, backgroundColor: colors.surface2 },
    filterChipRow: { flexDirection: "row", flexWrap: "wrap", gap: SPACE[1.5], paddingHorizontal: SPACE[1] },
    filterChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACE[1],
      paddingVertical: SPACE[1] - 1,
      paddingHorizontal: SPACE[2],
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    filterChipText: { color: colors.foreground, fontSize: FONT_SIZE.sm, fontFamily: MONO_FONT },
    panel: { backgroundColor: colors.surface1, padding: SPACE[4] },
    panelBordered: { borderTopWidth: 1, borderColor: colors.border },
    panelBody: { gap: SPACE[3] },
    panelHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    panelHeaderText: { color: colors.foreground, fontSize: FONT_SIZE.base, fontWeight: FONT_WEIGHT.semibold },
    iconButton: { padding: SPACE[1] },
    sectionLabel: {
      color: colors.foregroundMuted,
      fontSize: FONT_SIZE.sm,
      fontWeight: FONT_WEIGHT.semibold,
      letterSpacing: 0.4,
      marginBottom: SPACE[1.5],
    },
    sectionRow: { flexDirection: "row", flexWrap: "wrap", gap: SPACE[1.5] },
    linkGroup: { gap: SPACE[1] },
    linkItem: { flexDirection: "row", alignItems: "center", gap: SPACE[1.5], paddingVertical: SPACE[1] - 1 },
    linkDot: { width: 6, height: 6, borderRadius: RADIUS.full },
    linkItemId: { color: colors.accent, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.medium, fontFamily: MONO_FONT },
    linkItemTitle: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm, flexShrink: 1 },
    metaText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm },
    linkAction: { color: colors.accent, fontSize: FONT_SIZE.sm, textDecorationLine: "underline" },
    fieldLabel: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.medium, marginBottom: SPACE[1] },
    fieldInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADIUS.lg,
      padding: SPACE[2],
      color: colors.foreground,
      backgroundColor: colors.surface0,
      fontSize: FONT_SIZE.base,
      outlineWidth: 0,
    },
    fieldInputMultiline: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADIUS.lg,
      padding: SPACE[2],
      color: colors.foreground,
      backgroundColor: colors.surface0,
      minHeight: 84,
      textAlignVertical: "top",
      fontSize: FONT_SIZE.base,
      outlineWidth: 0,
    },
    markdownPreview: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADIUS.lg,
      padding: SPACE[2],
      backgroundColor: colors.surface0,
      minHeight: 84,
    },
    actionRow: { flexDirection: "row", alignItems: "center", gap: SPACE[2] },
    buttonDisabled: { opacity: 0.5 },
    tone: {
      neutral: { color: colors.foregroundMuted },
      success: { color: colors.statusSuccess },
      warning: { color: colors.statusWarning },
      danger: { color: colors.statusDanger },
      accent: { color: colors.accent },
    },
    chip: {
      base: {
        height: 28,
        justifyContent: "center",
        paddingHorizontal: SPACE[3],
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: "transparent",
      },
      selected: {
        height: 28,
        justifyContent: "center",
        paddingHorizontal: SPACE[3],
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
      },
      text: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm },
      textSelected: { color: colors.foreground, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.medium },
    },
    button: {
      primary: {
        base: {
          height: CONTROL_HEIGHT_SM,
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: SPACE[4],
          borderRadius: RADIUS.lg,
          backgroundColor: colors.accent,
        },
        text: { color: colors.accentForeground, fontSize: FONT_SIZE.base, fontWeight: FONT_WEIGHT.normal },
      },
      secondary: {
        base: {
          height: CONTROL_HEIGHT_SM,
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: SPACE[4],
          borderRadius: RADIUS.lg,
          backgroundColor: colors.surface2,
          borderWidth: 1,
          borderColor: colors.border,
        },
        text: { color: colors.foreground, fontSize: FONT_SIZE.base, fontWeight: FONT_WEIGHT.normal },
      },
      ghost: {
        base: {
          height: CONTROL_HEIGHT_SM,
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: SPACE[2],
          borderRadius: RADIUS.lg,
          backgroundColor: "transparent",
        },
        text: { color: colors.foregroundMuted, fontSize: FONT_SIZE.base, fontWeight: FONT_WEIGHT.normal },
      },
      destructive: {
        base: {
          height: CONTROL_HEIGHT_SM,
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: SPACE[4],
          borderRadius: RADIUS.lg,
          backgroundColor: colors.statusDanger,
        },
        text: { color: "#ffffff", fontSize: FONT_SIZE.base, fontWeight: FONT_WEIGHT.normal },
      },
    },
  };
}
