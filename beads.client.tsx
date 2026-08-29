import type { PluginTheme, PluginWorkspacePanelProps } from "@getpaseo/plugin";
import { useRpc, usePaseo, useWorkspace } from "@getpaseo/plugin";
import { Icon, useToast } from "@getpaseo/plugin/react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { formatRelativeDate } from "./format";
import { MarkdownText } from "./markdown";
import {
  createBeadRpc,
  deleteBeadRpc,
  getBeadRpc,
  listBeadsRpc,
  updateBeadRpc,
  type BeadDependency,
  type BeadIssue,
} from "./beads.shared";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";
type SortField = "id" | "title" | "status" | "priority" | "updatedAt";
type SortDirection = "asc" | "desc";
type ColumnKey = SortField | "type";
// Ahead of the currently published SDK (getpaseo/paseo#3901) — optional so this degrades
// to plain text on hosts that don't populate it yet.
type PluginNavigation = PluginWorkspacePanelProps["navigation"];

// Mirrors packages/app/src/styles/theme.ts SPACING/FONT_SIZE/BORDER_RADIUS/FONT_WEIGHT —
// the plugin runtime only exposes PluginTheme.colors, not the token objects themselves,
// so the scale is reproduced here to stay on the same rhythm as the host app.
const SPACE = { 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24 } as const;
const FONT_SIZE = { sm: 12, base: 14 } as const;
const FONT_WEIGHT = { normal: "normal", medium: "500", semibold: "600" } as const;
const RADIUS = { md: 6, lg: 8, full: 9999 } as const;
const CONTROL_HEIGHT_SM = 32;

const STATUS_OPTIONS = ["open", "in_progress", "blocked", "deferred", "closed"] as const;
const PRIORITY_VALUES = [0, 1, 2, 3, 4] as const;
const PRIORITY_LABELS = ["P0", "P1", "P2", "P3", "P4"];

// bd's built-in issue types (bd create --help): task | bug | feature | epic | chore | decision.
// Custom types (types.custom config) fall back to a generic marker.
const ISSUE_TYPE_ICONS: Record<string, string> = {
  task: "ListTodo",
  bug: "Bug",
  feature: "Sparkles",
  epic: "Layers",
  chore: "Wrench",
  decision: "Scale",
};

function issueTypeIcon(issueType: string): string {
  return ISSUE_TYPE_ICONS[issueType] ?? "Circle";
}

// Column order: a leading type glyph, identifying/scannable columns, free-text title last
// so the fixed columns hold a predictable width and the table doesn't stretch to the
// title's length. Only date-sortable/text-sortable columns are sortable; type is a glyph.
const COLUMNS: ReadonlyArray<{ key: ColumnKey; label: string; flex: number; sortable: boolean }> = [
  { key: "type", label: "", flex: 0.5, sortable: false },
  { key: "id", label: "ID", flex: 1.1, sortable: true },
  { key: "status", label: "STATUS", flex: 1, sortable: true },
  { key: "priority", label: "PRI", flex: 0.6, sortable: true },
  { key: "updatedAt", label: "UPDATED", flex: 1.1, sortable: true },
  { key: "title", label: "TITLE", flex: 3, sortable: true },
];

const WORKSPACE_REF_PREFIX = "paseo:";

interface BeadsWorkspace {
  id: string;
  title: string | null;
  gitRuntime?: { currentBranch?: string | null } | null;
}

/** True only for a workspace branch that this bead's suggested branch name actually owns —
 * an exact match or `<id>-<slug>`, never a loose substring that could false-match a sibling
 * id sharing a numeric prefix (e.g. "bd-1" inside "bd-10"). Fallback for beads created
 * before the `externalRef` backlink existed. */
function branchBelongsToBead(currentBranch: string | null | undefined, issueId: string): boolean {
  if (!currentBranch) return false;
  return currentBranch === issueId || currentBranch.startsWith(`${issueId}-`);
}

/** Prefers the exact `paseo:<workspaceId>` backlink written when the workspace was created
 * from this panel; falls back to the branch-name heuristic for beads/workspaces predating it
 * or where the linked workspace was since archived. */
function findActiveWorkspace(issue: BeadIssue, workspaces: readonly BeadsWorkspace[]): BeadsWorkspace | null {
  if (issue.externalRef?.startsWith(WORKSPACE_REF_PREFIX)) {
    const workspaceId = issue.externalRef.slice(WORKSPACE_REF_PREFIX.length);
    const linked = workspaces.find((workspace) => workspace.id === workspaceId);
    if (linked) return linked;
  }
  return workspaces.find((workspace) => branchBelongsToBead(workspace.gitRuntime?.currentBranch, issue.id)) ?? null;
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

interface PanelStyles {
  screen: ViewStyle;
  header: ViewStyle;
  title: TextStyle;
  refreshLabel: TextStyle;
  toolbar: ViewStyle;
  searchWrap: ViewStyle;
  searchIcon: ViewStyle;
  searchInput: TextStyle;
  detail: TextStyle;
  errorBanner: ViewStyle;
  errorBannerText: TextStyle;
  table: ViewStyle;
  headerRow: ViewStyle;
  headerCellFlex: ViewStyle;
  headerCell: ViewStyle;
  headerCellText: TextStyle;
  row: ViewStyle;
  rowBordered: ViewStyle;
  rowSelected: ViewStyle;
  cellText: TextStyle;
  cellTextMuted: TextStyle;
  panel: ViewStyle;
  panelBordered: ViewStyle;
  panelBody: ViewStyle;
  panelHeaderRow: ViewStyle;
  panelHeaderText: TextStyle;
  iconButton: ViewStyle;
  sectionLabel: TextStyle;
  sectionRow: ViewStyle;
  linkGroup: ViewStyle;
  linkRow: ViewStyle;
  linkText: TextStyle;
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

function buildStyles(theme: PluginTheme, compact: boolean): PanelStyles {
  const colors = theme.colors;
  return {
    screen: { flex: 1, padding: compact ? SPACE[3] : SPACE[4], backgroundColor: colors.surface0, gap: SPACE[3] },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { color: colors.foreground, fontSize: FONT_SIZE.base, fontWeight: FONT_WEIGHT.semibold },
    refreshLabel: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm },
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
      backgroundColor: colors.surface1,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    headerCellFlex: { flexDirection: "row", alignItems: "center" },
    headerCell: { flexDirection: "row", alignItems: "center", gap: SPACE[1] },
    headerCellText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold },
    row: {
      flexDirection: "row",
      paddingVertical: SPACE[2] + 2,
      paddingHorizontal: SPACE[3],
      alignItems: "center",
      backgroundColor: colors.surface0,
    },
    rowBordered: { borderTopWidth: 1, borderColor: colors.border },
    rowSelected: { backgroundColor: colors.surface2 },
    cellText: { color: colors.foreground, fontSize: FONT_SIZE.base },
    cellTextMuted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.sm },
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
    linkRow: { flexDirection: "row", alignItems: "center", gap: SPACE[1.5] },
    linkText: { color: colors.foreground, fontSize: FONT_SIZE.sm, flexShrink: 1 },
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

function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? `P${priority}`;
}

// Mirrors bd's actual status values (bd statuses) verbatim — matches the STATUS chip
// options exactly, so the table and the editor never disagree about what a status means.
const STATUS_TONES: Record<string, Tone> = {
  open: "warning",
  in_progress: "accent",
  blocked: "danger",
  deferred: "neutral",
  closed: "success",
};

function statusTone(status: string): { label: string; tone: Tone } {
  const label = status === "in_progress" ? "In progress" : status.charAt(0).toUpperCase() + status.slice(1);
  return { label, tone: STATUS_TONES[status] ?? "neutral" };
}


function branchSuggestion(issue: BeadIssue): string {
  return `${issue.id}-${issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40)}`;
}

function matchesQuery(issue: BeadIssue, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = `${issue.id} ${issue.title}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function compareBeads(a: BeadIssue, b: BeadIssue, field: SortField): number {
  if (field === "priority") return a.priority - b.priority;
  if (field === "updatedAt") return a.updatedAt.localeCompare(b.updatedAt);
  return a[field].localeCompare(b[field]);
}

function sortBeads(issues: BeadIssue[], field: SortField, direction: SortDirection): BeadIssue[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...issues].sort((a, b) => sign * compareBeads(a, b, field));
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function renderCell(key: ColumnKey, issue: BeadIssue, styles: PanelStyles): ReactNode {
  switch (key) {
    case "type":
      return <Icon name={issueTypeIcon(issue.issueType)} size={14} color={styles.cellTextMuted.color as string} />;
    case "id":
      return (
        <Text style={styles.cellTextMuted} numberOfLines={1}>
          {issue.id}
        </Text>
      );
    case "status": {
      const status = statusTone(issue.status);
      return (
        <Text style={[styles.cellText, styles.tone[status.tone]]} numberOfLines={1}>
          {status.label}
        </Text>
      );
    }
    case "priority":
      return <Text style={styles.cellTextMuted}>{priorityLabel(issue.priority)}</Text>;
    case "updatedAt":
      return <Text style={styles.cellTextMuted}>{formatRelativeDate(issue.updatedAt)}</Text>;
    case "title":
      return (
        <Text style={styles.cellText} numberOfLines={1}>
          {issue.title}
        </Text>
      );
  }
}

interface ButtonProps {
  label: string;
  variant: "primary" | "secondary" | "ghost" | "destructive";
  styles: PanelStyles;
  onPress: () => void;
  disabled?: boolean;
  icon?: string;
}

function Button({ label, variant, styles, onPress, disabled, icon }: ButtonProps) {
  const variantStyles = styles.button[variant];
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}>
      <View style={disabled ? [variantStyles.base, styles.buttonDisabled] : variantStyles.base}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE[1] }}>
          {icon ? <Icon name={icon} size={14} color={variantStyles.text.color as string} /> : null}
          <Text style={variantStyles.text}>{label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

interface ChipProps {
  label: string;
  active: boolean;
  styles: PanelStyles;
  onSelect: () => void;
}

function Chip({ label, active, styles, onSelect }: ChipProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onSelect}>
      <View style={active ? styles.chip.selected : styles.chip.base}>
        <Text style={active ? styles.chip.textSelected : styles.chip.text}>{label}</Text>
      </View>
    </Pressable>
  );
}

interface ColumnHeaderProps {
  column: (typeof COLUMNS)[number];
  sortField: SortField;
  sortDirection: SortDirection;
  styles: PanelStyles;
  theme: PluginTheme;
  onSort: (field: SortField) => void;
}

function ColumnHeader({ column, sortField, sortDirection, styles, theme, onSort }: ColumnHeaderProps) {
  const handlePress = useCallback(() => onSort(column.key as SortField), [onSort, column.key]);
  if (!column.sortable) {
    return (
      <View style={[styles.headerCellFlex, { flex: column.flex }]}>
        <Text style={styles.headerCellText}>{column.label}</Text>
      </View>
    );
  }
  const active = sortField === column.key;
  return (
    <Pressable accessibilityRole="button" onPress={handlePress} style={{ flex: column.flex }}>
      <View style={styles.headerCell}>
        <Text style={styles.headerCellText}>{column.label}</Text>
        {active ? (
          <Icon name={sortDirection === "asc" ? "ChevronUp" : "ChevronDown"} size={12} color={theme.colors.accent} />
        ) : null}
      </View>
    </Pressable>
  );
}

interface BeadRowProps {
  issue: BeadIssue;
  bordered: boolean;
  selected: boolean;
  styles: PanelStyles;
  onPress: (issue: BeadIssue) => void;
}

function BeadRow({ issue, bordered, selected, styles, onPress }: BeadRowProps) {
  const handlePress = useCallback(() => onPress(issue), [onPress, issue]);
  const rowStyle = [styles.row, bordered ? styles.rowBordered : null, selected ? styles.rowSelected : null];
  return (
    <Pressable accessibilityRole="button" onPress={handlePress}>
      <View style={rowStyle}>
        {COLUMNS.map((column) => (
          <View key={column.key} style={{ flex: column.flex }}>
            {renderCell(column.key, issue, styles)}
          </View>
        ))}
      </View>
    </Pressable>
  );
}

interface LinkRowProps {
  dependency: BeadDependency;
  styles: PanelStyles;
  onNavigate: (id: string) => void;
}

function LinkRow({ dependency, styles, onNavigate }: LinkRowProps) {
  const handlePress = useCallback(() => onNavigate(dependency.id), [onNavigate, dependency.id]);
  return (
    <Pressable accessibilityRole="button" onPress={handlePress}>
      <View style={styles.linkRow}>
        <Text style={styles.linkAction} numberOfLines={1}>
          {dependency.id}
          {dependency.title ? ` — ${dependency.title}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}

interface BeadDetailPanelProps {
  theme: PluginTheme;
  styles: PanelStyles;
  issue: BeadIssue;
  projectId: string;
  projectRootPath: string | null;
  activeWorkspace: BeadsWorkspace | null;
  isCurrentWorkspace: boolean;
  navigation: PluginNavigation | undefined;
  onIssueUpdated: (issue: BeadIssue) => void;
  onIssueDeleted: (id: string) => void;
  onWorkspaceCreated: () => void;
  onNavigateToBead: (id: string) => void;
}

function BeadDetailPanel({
  theme,
  styles,
  issue,
  projectId,
  projectRootPath,
  activeWorkspace,
  isCurrentWorkspace,
  navigation,
  onIssueUpdated,
  onIssueDeleted,
  onWorkspaceCreated,
  onNavigateToBead,
}: BeadDetailPanelProps) {
  const paseo = usePaseo();
  const toast = useToast();
  const updateBeadCall = useRpc(updateBeadRpc);
  const getBeadCall = useRpc(getBeadRpc);
  const deleteBeadCall = useRpc(deleteBeadRpc);

  const [editTitle, setEditTitle] = useState(issue.title);
  const [editDescription, setEditDescription] = useState(issue.description ?? "");
  const [editStatus, setEditStatus] = useState(issue.status);
  const [editPriority, setEditPriority] = useState(issue.priority);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [baseRef, setBaseRef] = useState("");

  // Keyed on id only, not the whole issue object: a background poll produces a new
  // `issue` reference every ~5s even when nothing changed, and resetting on every
  // reference would wipe in-progress edits out from under the user mid-keystroke.
  useEffect(() => {
    setEditTitle(issue.title);
    setEditDescription(issue.description ?? "");
    setEditStatus(issue.status);
    setEditPriority(issue.priority);
    setIsEditingDescription(false);
    setConfirmingDelete(false);
    setBranchName("");
    setBaseRef("");
  }, [issue.id]);

  // Resolves the reverse dependency direction ("required by"), which list/update/create
  // never return — only `bd show --include-dependents` does. Cheap, so fetched per expand
  // rather than for every row in the table.
  const detailQuery = useQuery({
    queryKey: ["bead-detail", projectId, issue.id],
    queryFn: () => getBeadCall({ projectId, id: issue.id }),
  });
  const dependencies = detailQuery.data?.issue?.dependencies ?? issue.dependencies;
  const dependents = detailQuery.data?.issue?.dependents ?? [];

  const isDirty =
    editTitle !== issue.title ||
    editDescription !== (issue.description ?? "") ||
    editStatus !== issue.status ||
    editPriority !== issue.priority;

  const updateMutation = useMutation({
    mutationFn: async () => {
      const patch: { title?: string; description?: string; priority?: number; status?: string } = {};
      if (editTitle !== issue.title) patch.title = editTitle;
      if (editDescription !== (issue.description ?? "")) patch.description = editDescription;
      if (editStatus !== issue.status) patch.status = editStatus;
      if (editPriority !== issue.priority) patch.priority = editPriority;
      return updateBeadCall({ projectId, id: issue.id, ...patch });
    },
    onSuccess: (result) => {
      if (result.error || !result.issue) {
        toast.error(result.error ?? "Failed to update bead");
        return;
      }
      toast.show("Bead updated", { variant: "success" });
      onIssueUpdated(result.issue);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to update bead");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteBeadCall({ projectId, id: issue.id }),
    onSuccess: (result) => {
      if (!result.deleted) {
        toast.error(result.error ?? "Failed to delete bead");
        return;
      }
      toast.show(`Deleted ${issue.id}`, { variant: "success" });
      onIssueDeleted(issue.id);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete bead");
    },
  });

  const suggested = branchSuggestion(issue);
  const canStart = !activeWorkspace && issue.status !== "closed" && issue.dependencyCount === 0;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!projectRootPath) throw new Error("Project root not found");
      const workspace = await paseo.workspaces.create({
        title: `${issue.id}: ${issue.title}`,
        source: {
          kind: "worktree",
          cwd: projectRootPath,
          action: "branch-off",
          ...(baseRef.trim() ? { refName: baseRef.trim() } : {}),
          branchName: branchName.trim() || suggested,
        },
      });
      // Backlink the bead to the workspace it spawned, so this panel (and anyone reading
      // the bead directly) can tell exactly which workspace is working it, instead of
      // guessing from the branch name.
      await updateBeadCall({ projectId, id: issue.id, externalRef: `${WORKSPACE_REF_PREFIX}${workspace.id}` });
    },
    onSuccess: () => {
      toast.show(`Workspace created for ${issue.id}`, { variant: "success" });
      setBranchName("");
      onWorkspaceCreated();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to create workspace");
    },
  });

  const handleConfirmStart = useCallback(() => createMutation.mutate(), [createMutation]);
  const handleApply = useCallback(() => updateMutation.mutate(), [updateMutation]);
  const handleStartEditingDescription = useCallback(() => setIsEditingDescription(true), []);
  const handleBlurDescription = useCallback(() => setIsEditingDescription(false), []);
  const handleRequestDelete = useCallback(() => setConfirmingDelete(true), []);
  const handleCancelDelete = useCallback(() => setConfirmingDelete(false), []);
  const handleConfirmDelete = useCallback(() => deleteMutation.mutate(), [deleteMutation]);

  const handleOpenWorkspace = useCallback(() => {
    if (activeWorkspace) navigation?.openWorkspace({ workspaceId: activeWorkspace.id });
  }, [navigation, activeWorkspace]);

  let workspaceStatus: ReactNode = null;
  if (activeWorkspace) {
    const workspaceLabel = activeWorkspace.title ?? activeWorkspace.gitRuntime?.currentBranch ?? activeWorkspace.id;
    if (isCurrentWorkspace) {
      workspaceStatus = <Text style={styles.tone.success}>This is the workspace you're viewing</Text>;
    } else if (navigation?.openWorkspace) {
      workspaceStatus = (
        <Pressable accessibilityRole="button" onPress={handleOpenWorkspace}>
          <Text style={styles.linkAction}>Active in workspace: {workspaceLabel}</Text>
        </Pressable>
      );
    } else {
      // Older hosts don't populate `navigation` yet — present the identity as plain text
      // rather than a link that can't actually work.
      workspaceStatus = <Text style={styles.tone.success}>Active in workspace: {workspaceLabel}</Text>;
    }
  } else if (issue.status !== "closed" && issue.dependencyCount > 0) {
    workspaceStatus = <Text style={styles.tone.danger}>Blocked by {pluralize(issue.dependencyCount, "open issue")}</Text>;
  }

  return (
    <View style={[styles.panel, styles.panelBordered]}>
      <View style={styles.panelBody}>
        <View style={styles.panelHeaderRow}>
          <Text style={styles.panelHeaderText}>{issue.id}</Text>
          <Pressable accessibilityRole="button" onPress={handleRequestDelete} style={styles.iconButton} disabled={deleteMutation.isPending}>
            <Icon name="Trash2" size={15} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>

        {confirmingDelete ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>Delete {issue.id} permanently? This removes its dependency links too.</Text>
            <View style={styles.actionRow}>
              <Button
                label={deleteMutation.isPending ? "Deleting..." : "Delete"}
                variant="destructive"
                styles={styles}
                onPress={handleConfirmDelete}
                disabled={deleteMutation.isPending}
              />
              <Button label="Cancel" variant="secondary" styles={styles} onPress={handleCancelDelete} disabled={deleteMutation.isPending} />
            </View>
          </View>
        ) : null}

        <View>
          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput value={editTitle} onChangeText={setEditTitle} style={styles.fieldInput} />
        </View>

        <View>
          <Text style={styles.sectionLabel}>STATUS</Text>
          <View style={styles.sectionRow}>
            {STATUS_OPTIONS.map((option) => (
              <Chip key={option} label={option} active={editStatus === option} styles={styles} onSelect={() => setEditStatus(option)} />
            ))}
          </View>
        </View>

        <View>
          <Text style={styles.sectionLabel}>PRIORITY</Text>
          <View style={styles.sectionRow}>
            {PRIORITY_VALUES.map((value) => (
              <Chip
                key={value}
                label={priorityLabel(value)}
                active={editPriority === value}
                styles={styles}
                onSelect={() => setEditPriority(value)}
              />
            ))}
          </View>
        </View>

        <View>
          <Text style={styles.sectionLabel}>DESCRIPTION</Text>
          {isEditingDescription ? (
            <TextInput
              value={editDescription}
              onChangeText={setEditDescription}
              onBlur={handleBlurDescription}
              multiline
              autoFocus
              placeholder="No description"
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.fieldInputMultiline}
            />
          ) : (
            <Pressable accessibilityRole="button" onPress={handleStartEditingDescription}>
              <View style={styles.markdownPreview}>
                {editDescription.trim() ? (
                  <MarkdownText content={editDescription} theme={theme} />
                ) : (
                  <Text style={styles.detail}>No description — tap to add</Text>
                )}
              </View>
            </Pressable>
          )}
        </View>

        {isDirty ? (
          <View style={styles.actionRow}>
            <Button
              label={updateMutation.isPending ? "Applying..." : "Apply changes"}
              variant="primary"
              styles={styles}
              onPress={handleApply}
              disabled={updateMutation.isPending}
            />
          </View>
        ) : null}

        <Text style={styles.metaText}>
          {issue.issueType} · updated {formatRelativeDate(issue.updatedAt)}
        </Text>

        {dependencies.length > 0 || dependents.length > 0 ? (
          <View style={styles.panelBody}>
            <Text style={styles.sectionLabel}>LINKS</Text>
            {dependencies.length > 0 ? (
              <View style={styles.linkGroup}>
                <Text style={styles.metaText}>Depends on</Text>
                {dependencies.map((dependency) => (
                  <LinkRow key={`dep-${dependency.id}`} dependency={dependency} styles={styles} onNavigate={onNavigateToBead} />
                ))}
              </View>
            ) : null}
            {dependents.length > 0 ? (
              <View style={styles.linkGroup}>
                <Text style={styles.metaText}>Required by</Text>
                {dependents.map((dependency) => (
                  <LinkRow key={`rdep-${dependency.id}`} dependency={dependency} styles={styles} onNavigate={onNavigateToBead} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {workspaceStatus}

        {!activeWorkspace && canStart ? (
          <View style={styles.panelBody}>
            <Text style={styles.sectionLabel}>WORKSPACE</Text>
            <View>
              <Text style={styles.fieldLabel}>Branch name</Text>
              <TextInput
                value={branchName}
                onChangeText={setBranchName}
                placeholder={suggested}
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.fieldInput}
              />
            </View>
            <View>
              <Text style={styles.fieldLabel}>Base ref (leave empty for the project default)</Text>
              <TextInput
                value={baseRef}
                onChangeText={setBaseRef}
                placeholder="origin/main"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.fieldInput}
              />
            </View>
            <View style={styles.actionRow}>
              <Button
                label={createMutation.isPending ? "Creating..." : "Create workspace"}
                variant="primary"
                styles={styles}
                onPress={handleConfirmStart}
                disabled={createMutation.isPending}
              />
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface BeadCreatePanelProps {
  theme: PluginTheme;
  styles: PanelStyles;
  projectId: string;
  onClose: () => void;
  onCreated: (issue: BeadIssue) => void;
}

function BeadCreatePanel({ theme, styles, projectId, onClose, onCreated }: BeadCreatePanelProps) {
  const toast = useToast();
  const createBeadCall = useRpc(createBeadRpc);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(2);

  const createMutation = useMutation({
    mutationFn: () =>
      createBeadCall({ projectId, title: title.trim(), description: description.trim() || undefined, priority }),
    onSuccess: (result) => {
      if (result.error || !result.issue) {
        toast.error(result.error ?? "Failed to create bead");
        return;
      }
      toast.show(`Created ${result.issue.id}`, { variant: "success" });
      onCreated(result.issue);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to create bead");
    },
  });

  const handleCreate = useCallback(() => {
    if (!title.trim()) return;
    createMutation.mutate();
  }, [title, createMutation]);

  const canCreate = Boolean(title.trim()) && !createMutation.isPending;

  return (
    <View style={[styles.panel, styles.panelBordered, { borderRadius: RADIUS.lg, borderTopWidth: 1 }]}>
      <View style={styles.panelBody}>
        <Text style={styles.panelHeaderText}>New bead</Text>

        <View>
          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What needs doing?"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.fieldInput}
            autoFocus
          />
        </View>

        <View>
          <Text style={styles.sectionLabel}>PRIORITY</Text>
          <View style={styles.sectionRow}>
            {PRIORITY_VALUES.map((value) => (
              <Chip key={value} label={priorityLabel(value)} active={priority === value} styles={styles} onSelect={() => setPriority(value)} />
            ))}
          </View>
        </View>

        <View>
          <Text style={styles.sectionLabel}>DESCRIPTION</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder="Optional details"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.fieldInputMultiline}
          />
        </View>

        <View style={styles.actionRow}>
          <Button
            label={createMutation.isPending ? "Creating..." : "Create bead"}
            variant="primary"
            styles={styles}
            onPress={handleCreate}
            disabled={!canCreate}
          />
          <Button label="Cancel" variant="secondary" styles={styles} onPress={onClose} />
        </View>
      </View>
    </View>
  );
}

export function BeadsWorkspacePanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const workspaceInfo = useWorkspace(workspaceId, (workspace) => ({
    projectId: workspace.projectId,
    projectRootPath: workspace.projectRootPath,
  }));
  const projectId = workspaceInfo?.projectId ?? null;
  const projectRootPath = workspaceInfo?.projectRootPath ?? null;

  const listBeads = useRpc(listBeadsRpc);
  const styles = useMemo(() => buildStyles(theme, layout.compact), [theme, layout.compact]);

  const beadsQuery = useQuery({
    queryKey: ["beads-list", projectId],
    queryFn: () => listBeads({ projectId: projectId ?? "" }),
    enabled: Boolean(projectId),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
  const refetchBeads = beadsQuery.refetch;

  const workspacesQuery = useQuery({
    queryKey: ["beads-workspaces", projectId],
    queryFn: () => paseo.workspaces.list({ filter: { projectId: projectId ?? "" } }),
    enabled: Boolean(projectId),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
  const refetchWorkspaces = workspacesQuery.refetch;
  const workspaces = (workspacesQuery.data?.entries ?? []) as BeadsWorkspace[];

  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("priority");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleSort = useCallback((field: SortField) => {
    setSortField((currentField) => {
      setSortDirection((currentDirection) => (currentField === field && currentDirection === "asc" ? "desc" : "asc"));
      return field;
    });
  }, []);
  // Accordion toggle: clicking the same row again closes it, matching the "roll-down"
  // convention used for the create panel below — no separate close affordance needed.
  const handleRowPress = useCallback((issue: BeadIssue) => {
    setCreating(false);
    setExpandedId((current) => (current === issue.id ? null : issue.id));
  }, []);
  const handleToggleCreate = useCallback(() => {
    setExpandedId(null);
    setCreating((current) => !current);
  }, []);
  const handleCloseCreate = useCallback(() => setCreating(false), []);
  const handleNavigateToBead = useCallback((id: string) => {
    setCreating(false);
    setQuery("");
    setExpandedId(id);
  }, []);
  const handleIssueUpdated = useCallback(() => {
    void refetchBeads();
  }, [refetchBeads]);
  const handleIssueDeleted = useCallback(() => {
    setExpandedId(null);
    void refetchBeads();
  }, [refetchBeads]);
  const handleIssueCreated = useCallback(() => {
    setCreating(false);
    void refetchBeads();
  }, [refetchBeads]);
  const handleWorkspaceCreated = useCallback(() => {
    setExpandedId(null);
    void refetchBeads();
    void refetchWorkspaces();
  }, [refetchBeads, refetchWorkspaces]);

  const allIssues = beadsQuery.data?.issues ?? [];
  const visibleIssues = useMemo(
    () => sortBeads(allIssues.filter((issue) => matchesQuery(issue, query)), sortField, sortDirection),
    [allIssues, query, sortField, sortDirection],
  );

  const available = Boolean(beadsQuery.data?.available);
  const showStaleErrorBanner = beadsQuery.isError && allIssues.length > 0;

  let content: ReactNode;
  if (!projectId) {
    content = <Text style={styles.detail}>No project for this workspace</Text>;
  } else if (beadsQuery.isPending) {
    content = <ActivityIndicator color={theme.colors.foregroundMuted} />;
  } else if (!available) {
    content = <Text style={styles.detail}>{beadsQuery.data?.error ?? "Beads is not set up for this project. Run `bd init` in its root checkout."}</Text>;
  } else if (visibleIssues.length === 0) {
    content = <Text style={styles.detail}>{query ? "No matching beads" : "No beads yet"}</Text>;
  } else {
    content = (
      <View style={styles.table}>
        <View style={styles.headerRow}>
          {COLUMNS.map((column) => (
            <ColumnHeader key={column.key} column={column} sortField={sortField} sortDirection={sortDirection} styles={styles} theme={theme} onSort={handleSort} />
          ))}
        </View>
        {visibleIssues.map((issue, index) => {
          const isExpanded = expandedId === issue.id;
          const activeWorkspace = findActiveWorkspace(issue, workspaces);
          return (
            <Fragment key={issue.id}>
              <BeadRow issue={issue} bordered={index > 0} selected={isExpanded} styles={styles} onPress={handleRowPress} />
              {isExpanded ? (
                <BeadDetailPanel
                  theme={theme}
                  styles={styles}
                  issue={issue}
                  projectId={projectId}
                  projectRootPath={projectRootPath}
                  activeWorkspace={activeWorkspace}
                  isCurrentWorkspace={activeWorkspace?.id === workspaceId}
                  navigation={navigation}
                  onIssueUpdated={handleIssueUpdated}
                  onIssueDeleted={handleIssueDeleted}
                  onWorkspaceCreated={handleWorkspaceCreated}
                  onNavigateToBead={handleNavigateToBead}
                />
              ) : null}
            </Fragment>
          );
        })}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ gap: SPACE[3] }}>
      <View style={styles.header}>
        <Text style={styles.title}>Beads</Text>
        <Text style={styles.refreshLabel}>{pluralize(allIssues.length, "issue")}</Text>
      </View>
      {showStaleErrorBanner ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>Couldn't refresh beads. Showing the last known list.</Text>
        </View>
      ) : null}
      {available ? (
        <View style={styles.toolbar}>
          <View style={styles.searchWrap}>
            <View style={styles.searchIcon}>
              <Icon name="Search" size={14} color={theme.colors.foregroundMuted} />
            </View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by id or title"
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.searchInput}
            />
          </View>
          <Button label="New bead" variant="primary" styles={styles} onPress={handleToggleCreate} icon="Plus" />
        </View>
      ) : null}
      {creating && projectId ? (
        <BeadCreatePanel theme={theme} styles={styles} projectId={projectId} onClose={handleCloseCreate} onCreated={handleIssueCreated} />
      ) : null}
      {content}
    </ScrollView>
  );
}
