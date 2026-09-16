import type { BeadIssue, BeadStatus } from "../shared/beads";
import type { Tone } from "./theme";

// Pure view-model logic for the Beads panel: search parsing, filtering, sorting, the
// epic-nested tree, and the small status/type/priority lookups. No React, no react-native.

export type SortField = "id" | "title" | "status" | "priority" | "updatedAt" | "type";
export type SortDirection = "asc" | "desc";
export type ColumnKey = SortField;

// Panel width (px, from onLayout) below which a column drops out, widest breakpoint first.
// `type`/`status`/`title` never drop (status collapses to a glyph — see STATUS_GLYPH_MAX_WIDTH
// — rather than disappearing); `id` drops last, on an ultra-narrow sidebar pane where the
// title is the more useful signal. When shown, `id` is never truncated.
export const COLUMN_MIN_WIDTH: Partial<Record<ColumnKey, number>> = {
  updatedAt: 600,
  priority: 520,
  id: 250,
};
// At or below this panel width the STATUS cell shows just the bd glyph, no label.
export const STATUS_GLYPH_MAX_WIDTH = 460;

// Fallback status vocabulary + glyphs, used until `beads.meta` resolves (or if it fails).
// `bd statuses --json` is the source of truth once loaded; it can include custom statuses.
export const FALLBACK_STATUSES = ["open", "in_progress", "blocked", "deferred", "closed"] as const;
const STATUS_GLYPH: Record<string, string> = {
  open: "○",
  in_progress: "◐",
  blocked: "●",
  deferred: "❄",
  closed: "✓",
  pinned: "📌",
  hooked: "◇",
};
export const PRIORITY_VALUES = [0, 1, 2, 3, 4] as const;
const PRIORITY_LABELS = ["P0", "P1", "P2", "P3", "P4"];

// bd's built-in issue types (`bd types`). Custom types (types.custom config) fall back to a
// generic marker. Used only for the row glyph — the create/edit pickers use `beads.meta`.
const ISSUE_TYPE_ICONS: Record<string, string> = {
  task: "ListTodo",
  bug: "Bug",
  feature: "Sparkles",
  epic: "Layers",
  chore: "Wrench",
  decision: "Scale",
  spike: "FlaskConical",
  story: "BookOpen",
  milestone: "Flag",
};

// Offered in the create/edit TYPE picker until `beads.meta` resolves.
export const FALLBACK_ISSUE_TYPES = ["task", "bug", "feature", "epic", "chore", "decision"] as const;

export function issueTypeIcon(issueType: string): string {
  return ISSUE_TYPE_ICONS[issueType] ?? "Circle";
}

// Column order: a leading type glyph, identifying/scannable columns, free-text title last
// so the fixed columns hold a predictable width and the table doesn't stretch to the
// title's length.
export const COLUMNS: ReadonlyArray<{ key: ColumnKey; label: string; flex: number; sortable: boolean }> = [
  { key: "type", label: "TYPE", flex: 0.5, sortable: true },
  { key: "id", label: "ID", flex: 1.1, sortable: true },
  { key: "status", label: "STATUS", flex: 1, sortable: true },
  { key: "priority", label: "PRI", flex: 0.6, sortable: true },
  { key: "updatedAt", label: "UPDATED", flex: 1.1, sortable: true },
  { key: "title", label: "TITLE", flex: 3, sortable: true },
];

// --- search / filter tokens -------------------------------------------------

// Search-field filter tokens: `key:value`, e.g. `type:bug status:open p1`. A space after the
// colon is tolerated (`type: bug`). Everything else is free text matched against id + title.
// `p0`..`p4` is sugar for `priority:0`..`priority:4`.
export const FILTER_KEYS = ["status", "type", "priority", "assignee", "parent"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

function isFilterKey(value: string): value is FilterKey {
  return (FILTER_KEYS as readonly string[]).includes(value);
}

export interface ParsedSearch {
  text: string;
  filters: Partial<Record<FilterKey, string>>;
}

export function parseSearch(raw: string): ParsedSearch {
  const filters: Partial<Record<FilterKey, string>> = {};
  const textParts: string[] = [];
  const tokens = raw.trim().split(/\s+/).filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    const bareP = /^p([0-4])$/i.exec(token);
    if (bareP) {
      filters.priority = bareP[1];
      continue;
    }

    const colon = token.indexOf(":");
    if (colon >= 0) {
      const key = token.slice(0, colon).toLowerCase();
      if (isFilterKey(key)) {
        // `key:value`, or `key:` / `key: value` where the value is the next token.
        let value = token.slice(colon + 1).toLowerCase();
        if (!value && i + 1 < tokens.length) value = tokens[++i].toLowerCase();
        if (value) {
          filters[key] = value;
          continue;
        }
      }
    }
    textParts.push(token);
  }
  return { text: textParts.join(" ").toLowerCase(), filters };
}

/** Serializes a ParsedSearch back into a query string (free text + `key:value` tokens). */
export function stringifySearch(search: ParsedSearch): string {
  const tokens = FILTER_KEYS.filter((key) => search.filters[key]).map((key) => `${key}:${search.filters[key]}`);
  return [search.text, ...tokens].filter(Boolean).join(" ");
}

export function dropFilter(search: ParsedSearch, key: FilterKey): ParsedSearch {
  const filters = { ...search.filters };
  delete filters[key];
  return { text: search.text, filters };
}

export function hasActiveFilters(search: ParsedSearch): boolean {
  return FILTER_KEYS.some((key) => search.filters[key]);
}

export function matchesSearch(issue: BeadIssue, search: ParsedSearch): boolean {
  if (search.text) {
    const haystack = `${issue.id} ${issue.title}`.toLowerCase();
    if (!haystack.includes(search.text)) return false;
  }
  const { filters } = search;
  if (filters.status && !issue.status.toLowerCase().includes(filters.status)) return false;
  if (filters.type && !issue.issueType.toLowerCase().includes(filters.type)) return false;
  if (filters.priority && String(issue.priority) !== filters.priority) return false;
  if (filters.parent && (issue.parent ?? "").toLowerCase() !== filters.parent) return false;
  if (filters.assignee) {
    const assignee = (issue.assignee ?? "").toLowerCase();
    if (filters.assignee === "none" ? assignee !== "" : !assignee.includes(filters.assignee)) return false;
  }
  return true;
}

// --- status / priority lookups --------------------------------------------

export function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? `P${priority}`;
}

// Per-name tone override; anything else falls back to the bd status *category*.
const STATUS_TONE_BY_NAME: Record<string, Tone> = {
  open: "warning",
  in_progress: "accent",
  blocked: "danger",
  closed: "success",
};
const STATUS_TONE_BY_CATEGORY: Record<string, Tone> = {
  active: "warning",
  wip: "accent",
  frozen: "neutral",
  done: "success",
};

/** Human label for a bd status name: `in_progress` → "In progress", `needs_review` →
 * "Needs review". Works for custom statuses too. */
export function statusLabel(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface StatusInfo {
  label: string;
  tone: Tone;
  glyph: string;
}

export function resolveStatus(status: string, statuses: readonly BeadStatus[]): StatusInfo {
  const meta = statuses.find((entry) => entry.name === status);
  const tone =
    STATUS_TONE_BY_NAME[status] ?? (meta ? STATUS_TONE_BY_CATEGORY[meta.category] : undefined) ?? "neutral";
  return { label: statusLabel(status), tone, glyph: meta?.icon ?? STATUS_GLYPH[status] ?? "•" };
}

/** Status option list for the editor: whatever bd reports, else the fallback set. */
export function statusOptions(statuses: readonly BeadStatus[]): string[] {
  return statuses.length > 0 ? statuses.map((entry) => entry.name) : [...FALLBACK_STATUSES];
}

// P0/P1 carry urgency and get a colour; P2–P4 stay muted so the eye isn't drawn to them.
export function priorityTone(priority: number): Tone {
  if (priority <= 0) return "danger";
  if (priority === 1) return "warning";
  return "neutral";
}

// --- workspace correlation -----------------------------------------------

export const WORKSPACE_REF_PREFIX = "paseo:";

export interface BeadsWorkspace {
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
export function findActiveWorkspace(
  issue: BeadIssue,
  workspaces: readonly BeadsWorkspace[],
): BeadsWorkspace | null {
  if (issue.externalRef?.startsWith(WORKSPACE_REF_PREFIX)) {
    const workspaceId = issue.externalRef.slice(WORKSPACE_REF_PREFIX.length);
    const linked = workspaces.find((workspace) => workspace.id === workspaceId);
    if (linked) return linked;
  }
  return workspaces.find((workspace) => branchBelongsToBead(workspace.gitRuntime?.currentBranch, issue.id)) ?? null;
}

export function branchSuggestion(issue: BeadIssue): string {
  return `${issue.id}-${issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40)}`;
}

// --- sorting -------------------------------------------------------------

// Natural, case-insensitive order so `bd-2` sorts before `bd-10` and `agent-phe.2.3`
// before `agent-phe.2.10`.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareBeads(a: BeadIssue, b: BeadIssue, field: SortField): number {
  if (field === "priority") return a.priority - b.priority || collator.compare(a.id, b.id);
  if (field === "updatedAt") return a.updatedAt.localeCompare(b.updatedAt);
  if (field === "type") return a.issueType.localeCompare(b.issueType) || collator.compare(a.id, b.id);
  if (field === "id") return collator.compare(a.id, b.id);
  return a[field].localeCompare(b[field]) || collator.compare(a.id, b.id);
}

export function sortBeads(issues: BeadIssue[], field: SortField, direction: SortDirection): BeadIssue[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...issues].sort((a, b) => sign * compareBeads(a, b, field));
}

// --- render list (flat / epic-nested tree) ------------------------------

export interface TreeRow {
  issue: BeadIssue;
  depth: number;
  /** Number of visible children in the tree (0 in the flat view). Drives the
   * collapse/expand toggle and the "N children" hint on a folded row. */
  childCount: number;
  /** True when this issue's subtree is collapsed and its children are hidden. */
  collapsed: boolean;
}

/** Flat, sorted, filtered render list — one row per matching issue, all at depth 0. */
export function buildFlatRows(
  issues: BeadIssue[],
  search: ParsedSearch,
  field: SortField,
  direction: SortDirection,
): TreeRow[] {
  return sortBeads(
    issues.filter((issue) => matchesSearch(issue, search)),
    field,
    direction,
  ).map((issue) => ({ issue, depth: 0, childCount: 0, collapsed: false }));
}

/** Epic-nested render list: children indented under their `parent`. A non-matching issue
 * is still shown when a descendant matches (so the tree stays connected); siblings are
 * sorted by the active column at every level. Mirrors `bd list`'s default tree output.
 * `collapsedIds` hides the subtree of any epic the user has folded away. */
export function buildGroupedRows(
  issues: BeadIssue[],
  search: ParsedSearch,
  field: SortField,
  direction: SortDirection,
  collapsedIds: ReadonlySet<string>,
): TreeRow[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const childrenOf = new Map<string | null, BeadIssue[]>();
  for (const issue of issues) {
    const parentId = issue.parent && byId.has(issue.parent) ? issue.parent : null;
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.push(issue);
    childrenOf.set(parentId, siblings);
  }

  const include = new Set<string>();
  for (const issue of issues) {
    if (!matchesSearch(issue, search)) continue;
    include.add(issue.id);
    let ancestor = issue.parent;
    while (ancestor && byId.has(ancestor) && !include.has(ancestor)) {
      include.add(ancestor);
      ancestor = byId.get(ancestor)?.parent ?? null;
    }
  }

  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const issue of sortBeads(childrenOf.get(parentId) ?? [], field, direction)) {
      if (!include.has(issue.id) || seen.has(issue.id)) continue;
      seen.add(issue.id);
      const childCount = (childrenOf.get(issue.id) ?? []).filter((child) => include.has(child.id)).length;
      const collapsed = childCount > 0 && collapsedIds.has(issue.id);
      rows.push({ issue, depth, childCount, collapsed });
      if (childCount > 0 && !collapsed) walk(issue.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
