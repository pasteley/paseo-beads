import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, usePaseo, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { formatRelativeDate } from "./format";
import { MarkdownText } from "./markdown";
import {
  beadsMetaRpc,
  createBeadRpc,
  deleteBeadRpc,
  enableBeadEventsRpc,
  getBeadRpc,
  initBeadsRpc,
  listBeadsRpc,
  MIN_BD_VERSION,
  updateBeadRpc,
  type BeadDependency,
  type BeadIssue,
  type BeadsFeedMode,
  type BeadsTransport,
  type BeadStatus,
  type ListBeadsResult,
} from "../shared/beads";
import {
  FONT_SIZE,
  RADIUS,
  SPACE,
  TREE_INDENT,
  buildStyles,
  hoverTitle,
  type PanelStyles,
} from "./theme";
import {
  COLUMNS,
  COLUMN_MIN_WIDTH,
  FALLBACK_ISSUE_TYPES,
  FILTER_KEYS,
  PRIORITY_VALUES,
  STATUS_GLYPH_MAX_WIDTH,
  WORKSPACE_REF_PREFIX,
  branchSuggestion,
  buildFlatRows,
  buildGroupedRows,
  dropFilter,
  findActiveWorkspace,
  hasActiveFilters,
  issueTypeIcon,
  matchesSearch,
  parseSearch,
  pluralize,
  priorityLabel,
  priorityTone,
  resolveStatus,
  statusLabel,
  statusOptions,
  stringifySearch,
  type BeadsWorkspace,
  type ColumnKey,
  type FilterKey,
  type SortDirection,
  type SortField,
  type TreeRow,
} from "./view";

// Ahead of the currently published SDK (getpaseo/paseo#3901) — optional so this degrades
// to plain text on hosts that don't populate it yet.
type PluginNavigation = PluginWorkspacePanelProps["navigation"];

/** Returns `value` delayed by `delayMs` — keeps the search box responsive while the (memoised
 * but not free) filter/tree rebuild only runs once typing pauses. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

interface CellContext {
  styles: PanelStyles;
  statuses: readonly BeadStatus[];
  /** Below STATUS_GLYPH_MAX_WIDTH the STATUS cell renders as just the bd glyph. */
  compactStatus: boolean;
}

function renderCell(key: ColumnKey, issue: BeadIssue, ctx: CellContext): ReactNode {
  const { styles } = ctx;
  switch (key) {
    case "type":
      return (
        <View
          accessibilityLabel={issue.issueType}
          {...hoverTitle(issue.issueType)}
          style={{ alignItems: "flex-start" }}
        >
          <Icon name={issueTypeIcon(issue.issueType)} size={15} color={styles.cellTextMuted.color as string} />
        </View>
      );
    case "id":
      // Never truncated — the id is how you refer to a bead, so it must always be readable.
      return <Text style={styles.cellId}>{issue.id}</Text>;
    case "status": {
      const status = resolveStatus(issue.status, ctx.statuses);
      const color = styles.tone[status.tone].color as string;
      if (ctx.compactStatus) {
        return (
          <Text accessibilityLabel={status.label} {...hoverTitle(status.label)} style={{ color, fontSize: FONT_SIZE.base }}>
            {status.glyph}
          </Text>
        );
      }
      return (
        <View style={styles.dotRow}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <Text style={[styles.cellText, styles.tone[status.tone]]} numberOfLines={1}>
            {status.label}
          </Text>
        </View>
      );
    }
    case "priority":
      return (
        <Text style={[styles.cellTextMuted, styles.tone[priorityTone(issue.priority)]]}>
          {priorityLabel(issue.priority)}
        </Text>
      );
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
  idColumnWidth: number;
  styles: PanelStyles;
  theme: PluginTheme;
  onSort: (field: SortField) => void;
}

// The id column is content-width (never truncated) but must line up between the header and
// the body, so both take the same explicit width, measured from the longest visible id.
function idCellStyle(idColumnWidth: number): ViewStyle {
  return { width: idColumnWidth, flexGrow: 0, flexShrink: 0, paddingRight: SPACE[3] };
}

function ColumnHeader({ column, sortField, sortDirection, idColumnWidth, styles, theme, onSort }: ColumnHeaderProps) {
  const handlePress = useCallback(() => onSort(column.key as SortField), [onSort, column.key]);
  const active = sortField === column.key;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={column.key === "id" ? idCellStyle(idColumnWidth) : { flex: column.flex }}
    >
      <View style={styles.headerCell}>
        <Text style={[styles.headerCellText, active ? { color: theme.colors.foreground } : null]}>{column.label}</Text>
        {active ? (
          <Icon name={sortDirection === "asc" ? "ChevronUp" : "ChevronDown"} size={12} color={theme.colors.accent} />
        ) : (
          <Icon name="ChevronsUpDown" size={11} color={theme.colors.border} />
        )}
      </View>
    </Pressable>
  );
}

type VisibleColumn = (typeof COLUMNS)[number];

interface BeadRowProps {
  row: TreeRow;
  columns: readonly VisibleColumn[];
  idColumnWidth: number;
  /** Fixed width of the leading tree gutter (0 when not grouped). Identical in the header
   * and every row, so the data columns stay grid-aligned regardless of nesting depth. */
  treeColumnWidth: number;
  cellContext: CellContext;
  bordered: boolean;
  selected: boolean;
  grouped: boolean;
  styles: PanelStyles;
  theme: PluginTheme;
  onPress: (issue: BeadIssue) => void;
  onToggleCollapse: (id: string) => void;
}

function BeadRow({
  row,
  columns,
  idColumnWidth,
  treeColumnWidth,
  cellContext,
  bordered,
  selected,
  grouped,
  styles,
  theme,
  onPress,
  onToggleCollapse,
}: BeadRowProps) {
  const { issue, depth, childCount, collapsed } = row;
  const isGroupHeader = grouped && childCount > 0;
  const handlePress = useCallback(() => onPress(issue), [onPress, issue]);
  // Stop the tap from also reaching the row Pressable (which would open the detail panel).
  const handleToggle = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onToggleCollapse(issue.id);
    },
    [onToggleCollapse, issue.id],
  );
  const rowStyle = [
    styles.row,
    bordered ? styles.rowBordered : null,
    isGroupHeader ? styles.groupHeaderRow : null,
    selected ? styles.rowSelected : null,
  ];
  return (
    <Pressable accessibilityRole="button" onPress={handlePress}>
      <View style={rowStyle}>
        {grouped ? (
          <View style={{ width: treeColumnWidth, flexDirection: "row", alignItems: "center" }}>
            {childCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={collapsed ? `Expand ${issue.id}` : `Collapse ${issue.id}`}
                onPress={handleToggle}
                style={[styles.groupToggle, { marginLeft: depth * TREE_INDENT }]}
              >
                {/* One glyph, rotated — ChevronRight and ChevronDown don't have identical
                    metrics, which made the row twitch on toggle. */}
                <View style={{ transform: [{ rotate: collapsed ? "-90deg" : "0deg" }] }}>
                  <Icon name="ChevronDown" size={14} color={theme.colors.foregroundMuted} />
                </View>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {columns.map((column) => (
          <View key={column.key} style={column.key === "id" ? idCellStyle(idColumnWidth) : { flex: column.flex }}>
            {renderCell(column.key, issue, cellContext)}
          </View>
        ))}
        {grouped && collapsed ? (
          <Text style={[styles.cellTextMuted, { marginLeft: "auto", paddingLeft: SPACE[2] }]}>
            {childCount === 1 ? "1 child" : `${childCount} children`}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const LINK_LIST_CAP = 6;
const DESC_LONG_CHARS = 700;
const DESC_LONG_LINES = 14;
const DESC_COLLAPSED_HEIGHT = 260;

interface LinkListProps {
  label: string;
  dependencies: readonly BeadDependency[];
  statuses: readonly BeadStatus[];
  styles: PanelStyles;
  onNavigate: (id: string) => void;
}

// A bulleted, one-per-line list: status dot · id · title. Stays a list no matter how many
// there are (long lists were previously wrapping into an unreadable pill blob); past
// LINK_LIST_CAP the tail collapses behind a "show more" toggle.
function LinkList({ label, dependencies, statuses, styles, onNavigate }: LinkListProps) {
  const [expanded, setExpanded] = useState(false);
  if (dependencies.length === 0) return null;
  const shown = expanded ? dependencies : dependencies.slice(0, LINK_LIST_CAP);
  const hidden = dependencies.length - shown.length;
  return (
    <View style={styles.linkGroup}>
      <Text style={styles.metaText}>
        {label} ({dependencies.length})
      </Text>
      {shown.map((dependency) => {
        const dotColor = styles.tone[resolveStatus(dependency.status, statuses).tone].color as string;
        return (
          <Pressable
            key={`${label}-${dependency.id}`}
            accessibilityRole="button"
            onPress={() => onNavigate(dependency.id)}
            style={styles.linkItem}
          >
            <View style={[styles.linkDot, { backgroundColor: dotColor }]} />
            <Text style={styles.linkItemId}>{dependency.id}</Text>
            {dependency.title ? (
              <Text style={styles.linkItemTitle} numberOfLines={1}>
                {dependency.title}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
      {hidden > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded(true)}>
          <Text style={styles.linkAction}>Show {hidden} more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface BeadDetailPanelProps {
  theme: PluginTheme;
  styles: PanelStyles;
  issue: BeadIssue;
  projectId: string;
  projectRootPath: string | null;
  types: readonly string[];
  statuses: readonly BeadStatus[];
  activeWorkspace: BeadsWorkspace | null;
  isCurrentWorkspace: boolean;
  navigation: PluginNavigation | undefined;
  onIssueUpdated: (issue: BeadIssue) => void;
  onIssueDeleted: (id: string) => void;
  onWorkspaceCreated: () => void;
  onNavigateToBead: (id: string) => void;
}

// Options for the type/status pickers: always include the bead's current value even if bd
// didn't list it (e.g. a type removed from config after the bead was created).
function withCurrent(options: readonly string[], current: string): string[] {
  return options.includes(current) ? [...options] : [current, ...options];
}

function BeadDetailPanel({
  theme,
  styles,
  issue,
  projectId,
  projectRootPath,
  types,
  statuses,
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
  const [editType, setEditType] = useState(issue.issueType);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionHeight, setDescriptionHeight] = useState(0);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
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
    setEditType(issue.issueType);
    setIsEditingDescription(false);
    setDescriptionExpanded(false);
    setConfirmingDelete(false);
    setBranchName("");
    setBaseRef("");
  }, [issue.id]);

  // A description longer than this (roughly a screenful) starts collapsed with a toggle,
  // so a wall of text doesn't bury the LINKS / WORKSPACE sections below it.
  const descriptionIsLong =
    editDescription.length > DESC_LONG_CHARS || editDescription.split("\n").length > DESC_LONG_LINES;
  const descriptionClamped = descriptionIsLong && !descriptionExpanded;
  const handleToggleDescription = useCallback(() => setDescriptionExpanded((current) => !current), []);

  const statusChoices = useMemo(() => withCurrent(statusOptions(statuses), issue.status), [statuses, issue.status]);
  const typeChoices = useMemo(
    () => withCurrent(types.length > 0 ? types : [...FALLBACK_ISSUE_TYPES], issue.issueType),
    [types, issue.issueType],
  );

  // Everything this panel shows is already in the cached row — text, and both link directions
  // (the server reverse-indexes the edges). The fetch is a fallback for a bead we only know from
  // a journal record that carried no description, so normally it never runs.
  const detailQuery = useQuery({
    queryKey: ["bead-detail", projectId, issue.id],
    queryFn: () => getBeadCall({ projectId, id: issue.id }),
    enabled: issue.description === null,
  });
  const fetchedIssue = detailQuery.data?.issue ?? null;
  const dependencies = issue.dependencies.length > 0 ? issue.dependencies : fetchedIssue?.dependencies ?? [];
  const dependents = issue.dependents.length > 0 ? issue.dependents : fetchedIssue?.dependents ?? [];

  // Seed the editor once the text arrives, unless the user is already typing into it.
  const fetchedDescription = fetchedIssue?.description ?? null;
  useEffect(() => {
    if (fetchedDescription === null || isEditingDescription || editDescription !== "") return;
    setEditDescription(fetchedDescription);
  }, [fetchedDescription, isEditingDescription, editDescription]);

  const baseDescription = issue.description ?? fetchedDescription ?? "";
  const isDirty =
    editTitle !== issue.title ||
    editDescription !== baseDescription ||
    editStatus !== issue.status ||
    editPriority !== issue.priority ||
    editType !== issue.issueType;

  const updateMutation = useMutation({
    mutationFn: async () => {
      const patch: {
        title?: string;
        description?: string;
        priority?: number;
        status?: string;
        issueType?: string;
      } = {};
      if (editTitle !== issue.title) patch.title = editTitle;
      if (editDescription !== baseDescription) patch.description = editDescription;
      if (editStatus !== issue.status) patch.status = editStatus;
      if (editPriority !== issue.priority) patch.priority = editPriority;
      if (editType !== issue.issueType) patch.issueType = editType;
      return updateBeadCall({ projectId, id: issue.id, ...patch, ifStatus: issue.status });
    },
    onSuccess: (result) => {
      if (result.conflict) {
        toast.error(result.error ?? "That bead changed while you were editing it.");
        onIssueUpdated(issue); // reloads the list; the edits stay in the form
        return;
      }
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
            {statusChoices.map((option) => (
              <Chip
                key={option}
                label={statusLabel(option)}
                active={editStatus === option}
                styles={styles}
                onSelect={() => setEditStatus(option)}
              />
            ))}
          </View>
        </View>

        <View>
          <Text style={styles.sectionLabel}>TYPE</Text>
          <View style={styles.sectionRow}>
            {typeChoices.map((option) => (
              <Chip key={option} label={option} active={editType === option} styles={styles} onSelect={() => setEditType(option)} />
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
              onContentSizeChange={(event) => setDescriptionHeight(event.nativeEvent.contentSize.height)}
              multiline
              autoFocus
              placeholder="No description"
              placeholderTextColor={theme.colors.foregroundMuted}
              style={[styles.fieldInputMultiline, descriptionHeight > 0 ? { height: Math.max(84, descriptionHeight) } : null]}
            />
          ) : (
            <>
              <Pressable accessibilityRole="button" onPress={handleStartEditingDescription}>
                <View
                  style={[
                    styles.markdownPreview,
                    descriptionClamped ? { maxHeight: DESC_COLLAPSED_HEIGHT, overflow: "hidden" } : null,
                  ]}
                >
                  {editDescription.trim() ? (
                    <MarkdownText content={editDescription} theme={theme} />
                  ) : (
                    <Text style={styles.detail}>No description — tap to add</Text>
                  )}
                </View>
              </Pressable>
              {descriptionIsLong ? (
                <Pressable accessibilityRole="button" onPress={handleToggleDescription} style={{ paddingTop: SPACE[1] }}>
                  <Text style={styles.linkAction}>
                    {descriptionExpanded ? "Show less" : "Show full description"}
                  </Text>
                </Pressable>
              ) : null}
            </>
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

        <Text style={styles.metaText}>updated {formatRelativeDate(issue.updatedAt)}</Text>

        {dependencies.length > 0 || dependents.length > 0 ? (
          <View style={styles.panelBody}>
            <Text style={styles.sectionLabel}>LINKS</Text>
            <LinkList
              label="Depends on"
              dependencies={dependencies}
              statuses={statuses}
              styles={styles}
              onNavigate={onNavigateToBead}
            />
            <LinkList
              label="Required by"
              dependencies={dependents}
              statuses={statuses}
              styles={styles}
              onNavigate={onNavigateToBead}
            />
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
  types: readonly string[];
  onClose: () => void;
  onCreated: (issue: BeadIssue) => void;
}

function BeadCreatePanel({ theme, styles, projectId, types, onClose, onCreated }: BeadCreatePanelProps) {
  const toast = useToast();
  const createBeadCall = useRpc(createBeadRpc);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionHeight, setDescriptionHeight] = useState(0);
  const [priority, setPriority] = useState(2);
  const [issueType, setIssueType] = useState<string>("task");
  const typeChoices = types.length > 0 ? types : [...FALLBACK_ISSUE_TYPES];

  const createMutation = useMutation({
    mutationFn: () =>
      createBeadCall({
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        issueType,
      }),
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
          <Text style={styles.sectionLabel}>TYPE</Text>
          <View style={styles.sectionRow}>
            {typeChoices.map((option) => (
              <Chip key={option} label={option} active={issueType === option} styles={styles} onSelect={() => setIssueType(option)} />
            ))}
          </View>
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
            onContentSizeChange={(event) => setDescriptionHeight(event.nativeEvent.contentSize.height)}
            multiline
            placeholder="Optional details"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={[styles.fieldInputMultiline, descriptionHeight > 0 ? { height: Math.max(84, descriptionHeight) } : null]}
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

// Placeholder rows shown while the first list request is in flight — reads as "a table is
// loading here" instead of a bare centred spinner.
function SkeletonTable({ styles, theme }: { styles: PanelStyles; theme: PluginTheme }) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <View style={[styles.skeletonBar, { width: 60 }]} />
      </View>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <View key={index} style={[styles.row, index > 0 ? styles.rowBordered : null]}>
          <Icon name="Circle" size={14} color={theme.colors.border} />
          <View style={[styles.skeletonBar, { width: 72, marginLeft: SPACE[3] }]} />
          <View style={[styles.skeletonBar, { flex: 1, marginLeft: SPACE[3], maxWidth: 260 }]} />
        </View>
      ))}
    </View>
  );
}

interface FeedStatusProps {
  mode: BeadsFeedMode;
  transport: BeadsTransport;
  supportsEvents: boolean;
  journalEnabled: boolean;
  bdVersion: string | null;
  enabling: boolean;
  styles: PanelStyles;
  theme: PluginTheme;
  onEnable: () => void;
}

/** Footer badge for where the list comes from. When bd can follow the journal but the workspace
 * hasn't opted in, the badge is the opt-in. */
function FeedStatus({
  mode,
  transport,
  supportsEvents,
  journalEnabled,
  bdVersion,
  enabling,
  styles,
  theme,
  onEnable,
}: FeedStatusProps) {
  if (mode === "live") {
    const served = transport === "http";
    return (
      <View
        style={styles.feedStatus}
        {...hoverTitle(
          served
            ? "Following `bd serve`'s event stream — no `bd` process per call"
            : "Following `bd events tail` — no polling",
        )}
      >
        <Icon name="Circle" size={8} color={theme.colors.statusSuccess} />
        <Text style={styles.footerCount}>{served ? "Live · served" : "Live"}</Text>
      </View>
    );
  }

  if (!supportsEvents) {
    return (
      <Text
        style={styles.footerCount}
        {...hoverTitle(`Live updates need bd ${MIN_BD_VERSION} or newer`)}
      >
        Polling every 5s{bdVersion ? ` · bd ${bdVersion}` : ""}
      </Text>
    );
  }

  if (!journalEnabled) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Enable live updates"
        onPress={onEnable}
        disabled={enabling}
        {...hoverTitle("Runs `bd config set events-journal true` — every bd command in this checkout is journaled from then on")}
      >
        <Text style={enabling ? [styles.linkAction, styles.buttonDisabled] : styles.linkAction}>
          {enabling ? "Enabling live updates..." : "Enable live updates"}
        </Text>
      </Pressable>
    );
  }

  return <Text style={styles.footerCount}>Polling every 5s</Text>;
}

/** True when two snapshots differ only in their issue list — i.e. an `unchanged` response
 * whose feed state also matches, so the previous object can be handed back as-is. */
function isSameFeedState(previous: ListBeadsResult, next: ListBeadsResult): boolean {
  return (
    previous.revision === next.revision &&
    previous.available === next.available &&
    previous.error === next.error &&
    previous.mode === next.mode &&
    previous.transport === next.transport &&
    previous.transportError === next.transportError &&
    previous.supportsEvents === next.supportsEvents &&
    previous.journalEnabled === next.journalEnabled &&
    previous.bdVersion === next.bdVersion
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
  const initBeadsCall = useRpc(initBeadsRpc);
  const beadsMetaCall = useRpc(beadsMetaRpc);
  const enableEventsCall = useRpc(enableBeadEventsRpc);
  const toast = useToast();
  const styles = useMemo(() => buildStyles(theme, layout.compact), [theme, layout.compact]);

  // Last snapshot we were handed, so a poll can say "still on revision N" and be answered
  // with `unchanged` instead of the whole list. Revisions are per project root, so a project
  // switch drops the cursor rather than carrying it across.
  const snapshotRef = useRef<{ projectId: string; result: ListBeadsResult } | null>(null);

  const beadsQuery = useQuery({
    queryKey: ["beads-list", projectId],
    queryFn: async () => {
      const id = projectId ?? "";
      const cached = snapshotRef.current?.projectId === id ? snapshotRef.current.result : null;
      const result = await listBeads({ projectId: id, sinceRevision: cached?.revision });
      // An `unchanged` response carries no issues: keep the list we already hold, and keep the
      // whole object identical when nothing else moved either, so nothing re-renders.
      const next =
        result.unchanged && cached
          ? isSameFeedState(cached, result)
            ? cached
            : { ...result, issues: cached.issues }
          : result;
      snapshotRef.current = { projectId: id, result: next };
      return next;
    },
    enabled: Boolean(projectId),
    // Live mode answers from a cache the journal keeps in step — no `bd` process per read —
    // so it can afford a tighter interval than the `bd list` fallback.
    refetchInterval: (query) => (query.state.data?.mode === "live" ? 2_000 : 5_000),
    refetchOnWindowFocus: true,
  });
  const refetchBeads = beadsQuery.refetch;

  const feedMode = beadsQuery.data?.mode ?? "poll";
  const transport = beadsQuery.data?.transport ?? "cli";
  const supportsEvents = beadsQuery.data?.supportsEvents ?? false;
  const journalEnabled = beadsQuery.data?.journalEnabled ?? false;
  const bdVersion = beadsQuery.data?.bdVersion ?? null;
  const transportError = beadsQuery.data?.transportError ?? null;

  const enableEventsMutation = useMutation({
    mutationFn: () => enableEventsCall({ projectId: projectId ?? "" }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error ?? "Failed to enable the bd events journal");
        return;
      }
      toast.show("Live updates on", { variant: "success" });
      snapshotRef.current = null;
      void refetchBeads();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to enable the bd events journal");
    },
  });
  const handleEnableEvents = useCallback(() => enableEventsMutation.mutate(), [enableEventsMutation]);

  // Type/status vocabularies rarely change — fetch once per mount, no polling.
  const metaQuery = useQuery({
    queryKey: ["beads-meta", projectId],
    queryFn: () => beadsMetaCall({ projectId: projectId ?? "" }),
    enabled: Boolean(projectId),
    staleTime: 5 * 60_000,
  });
  const types = metaQuery.data?.types ?? [];
  const statuses = metaQuery.data?.statuses ?? [];

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
  const [grouped, setGrouped] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [panelWidth, setPanelWidth] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleToggleGrouped = useCallback(() => setGrouped((current) => !current), []);
  const handleToggleCollapse = useCallback((id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleTableLayout = useCallback((event: LayoutChangeEvent) => {
    setPanelWidth(event.nativeEvent.layout.width);
  }, []);
  const handleClearFilter = useCallback((key: FilterKey) => {
    setQuery((current) => stringifySearch(dropFilter(parseSearch(current), key)));
  }, []);

  const initMutation = useMutation({
    mutationFn: () => initBeadsCall({ projectId: projectId ?? "" }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error ?? "Failed to run `bd init`");
        return;
      }
      toast.show("Beads initialized", { variant: "success" });
      void refetchBeads();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to run `bd init`");
    },
  });
  const handleInit = useCallback(() => initMutation.mutate(), [initMutation]);

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
  const debouncedQuery = useDebouncedValue(query, 200);
  const search = useMemo(() => parseSearch(debouncedQuery), [debouncedQuery]);
  const matchCount = useMemo(
    () => (query.trim() ? allIssues.filter((issue) => matchesSearch(issue, search)).length : allIssues.length),
    [allIssues, search, query],
  );
  const rows = useMemo(
    () =>
      grouped
        ? buildGroupedRows(allIssues, search, sortField, sortDirection, collapsedIds)
        : buildFlatRows(allIssues, search, sortField, sortDirection),
    [allIssues, search, sortField, sortDirection, grouped, collapsedIds],
  );

  // Drop the low-priority columns first as the panel narrows (e.g. docked in the sidebar).
  // `panelWidth === 0` is the pre-measure first paint — show everything rather than flash
  // a stripped-down table.
  const visibleColumns = useMemo(
    () => COLUMNS.filter((column) => panelWidth === 0 || panelWidth >= (COLUMN_MIN_WIDTH[column.key] ?? 0)),
    [panelWidth],
  );
  const compactStatus = panelWidth > 0 && panelWidth <= STATUS_GLYPH_MAX_WIDTH;
  const cellContext = useMemo<CellContext>(() => ({ styles, statuses, compactStatus }), [styles, statuses, compactStatus]);

  // Width the id column needs to show its longest visible id in full — the id is never
  // truncated, so the column is sized to content (mono ≈ 8px/char at 12px + gutter).
  const idColumnWidth = useMemo(() => {
    const longest = rows.reduce((max, row) => Math.max(max, row.issue.id.length), 2);
    return Math.min(260, Math.max(48, longest * 8 + SPACE[3]));
  }, [rows]);

  // Fixed leading gutter for the grouped tree: wide enough for the deepest chevron. Shared
  // by the header and every row so data columns never drift with nesting depth.
  const treeColumnWidth = useMemo(() => {
    if (!grouped) return 0;
    const maxDepth = rows.reduce((max, row) => Math.max(max, row.depth), 0);
    return Math.min(120, maxDepth * TREE_INDENT + 22);
  }, [grouped, rows]);

  const available = Boolean(beadsQuery.data?.available);
  const showStaleErrorBanner = beadsQuery.isError && allIssues.length > 0;
  const showVersionBanner = available && beadsQuery.data !== undefined && !supportsEvents;
  const notice = transportError ?? null;

  let content: ReactNode;
  if (!projectId) {
    content = <Text style={styles.detail}>No project for this workspace</Text>;
  } else if (beadsQuery.isPending) {
    content = <SkeletonTable styles={styles} theme={theme} />;
  } else if (!available) {
    content = (
      <View style={{ gap: SPACE[3] }}>
        <Text style={styles.detail}>
          {beadsQuery.data?.error ?? "Beads is not set up for this project. Run `bd init` in its root checkout."}
        </Text>
        {projectId ? (
          <View style={styles.actionRow}>
            <Button
              label={initMutation.isPending ? "Running bd init..." : "Run bd init"}
              variant="primary"
              styles={styles}
              icon="Play"
              onPress={handleInit}
              disabled={initMutation.isPending}
            />
          </View>
        ) : null}
        {projectRootPath ? (
          <Text style={styles.metaText}>Runs `bd init --non-interactive` in {projectRootPath}</Text>
        ) : null}
      </View>
    );
  } else if (rows.length === 0) {
    content = (
      <Text style={styles.detail}>{query.trim() ? "No beads match your search." : "No beads yet"}</Text>
    );
  } else {
    content = (
      <View style={styles.table} onLayout={handleTableLayout}>
        <View style={styles.headerRow}>
          {grouped ? <View style={{ width: treeColumnWidth }} /> : null}
          {visibleColumns.map((column) => (
            <ColumnHeader
              key={column.key}
              column={column}
              sortField={sortField}
              sortDirection={sortDirection}
              idColumnWidth={idColumnWidth}
              styles={styles}
              theme={theme}
              onSort={handleSort}
            />
          ))}
        </View>
        {rows.map((row, index) => {
          const { issue } = row;
          const isExpanded = expandedId === issue.id;
          const activeWorkspace = findActiveWorkspace(issue, workspaces);
          return (
            <Fragment key={issue.id}>
              <BeadRow
                row={row}
                columns={visibleColumns}
                idColumnWidth={idColumnWidth}
                treeColumnWidth={treeColumnWidth}
                cellContext={cellContext}
                bordered={index > 0}
                selected={isExpanded}
                grouped={grouped}
                styles={styles}
                theme={theme}
                onPress={handleRowPress}
                onToggleCollapse={handleToggleCollapse}
              />
              {isExpanded ? (
                <BeadDetailPanel
                  theme={theme}
                  styles={styles}
                  issue={issue}
                  projectId={projectId}
                  projectRootPath={projectRootPath}
                  types={types}
                  statuses={statuses}
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
      {showStaleErrorBanner ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>Couldn't refresh beads. Showing the last known list.</Text>
        </View>
      ) : null}
      {notice ? (
        <View style={styles.noticeBanner}>
          <Text style={styles.noticeBannerText}>{notice}</Text>
        </View>
      ) : null}
      {showVersionBanner ? (
        <View style={styles.noticeBanner}>
          <Text style={styles.noticeBannerText}>
            This plugin targets bd {MIN_BD_VERSION} or newer{bdVersion ? ` — found ${bdVersion}` : ""}. It works
            without it, but the list falls back to polling instead of following the events journal.
          </Text>
        </View>
      ) : null}
      {available ? (
        <View style={{ gap: SPACE[2] }}>
          <View style={styles.toolbar}>
            <View style={styles.searchWrap}>
              <View style={styles.searchIcon}>
                <Icon name="Search" size={14} color={theme.colors.foregroundMuted} />
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search or filter — e.g. type:bug p1"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.searchInput}
              />
            </View>
            <Button
              label="Group"
              variant={grouped ? "secondary" : "ghost"}
              styles={styles}
              onPress={handleToggleGrouped}
              icon="ListTree"
            />
            <Button label="New" variant="primary" styles={styles} onPress={handleToggleCreate} icon="Plus" />
          </View>
          {hasActiveFilters(search) ? (
            <View style={styles.filterChipRow}>
              {FILTER_KEYS.filter((key) => search.filters[key]).map((key) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove filter ${key}:${search.filters[key]}`}
                  onPress={() => handleClearFilter(key)}
                >
                  <View style={styles.filterChip}>
                    <Text style={styles.filterChipText}>
                      {key}:{search.filters[key]}
                    </Text>
                    <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {creating && projectId ? (
        <BeadCreatePanel
          theme={theme}
          styles={styles}
          projectId={projectId}
          types={types}
          onClose={handleCloseCreate}
          onCreated={handleIssueCreated}
        />
      ) : null}
      {content}
      {available ? (
        <View style={styles.footerRow}>
          {allIssues.length > 0 ? (
            <Text style={styles.footerCount}>
              {matchCount === allIssues.length
                ? pluralize(allIssues.length, "issue")
                : `${matchCount} of ${allIssues.length} issues`}
            </Text>
          ) : null}
          <FeedStatus
            mode={feedMode}
            transport={transport}
            supportsEvents={supportsEvents}
            journalEnabled={journalEnabled}
            bdVersion={bdVersion}
            enabling={enableEventsMutation.isPending}
            styles={styles}
            theme={theme}
            onEnable={handleEnableEvents}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}
