/** The bead model the panel renders, and the wire shapes it is decoded from. */

export interface BeadDependency {
  id: string;
  title: string;
  status: string;
  dependencyType: string;
}

export interface BeadIssue {
  id: string;
  title: string;
  description: string | null;
  status: string; // open | in_progress | blocked | deferred | closed
  priority: number; // 0 (highest) .. 4 (lowest)
  issueType: string;
  assignee: string | null;
  /** Direct parent issue id (`parent-child` dependency), or null for a top-level issue. */
  parent: string | null;
  dependencyCount: number;
  dependentCount: number;
  commentCount: number;
  /** Issues this one depends on (the "blocked by" direction), typed by relation:
   * blocks | tracks | related | parent-child | discovered-from. */
  dependencies: BeadDependency[];
  /** The reverse direction. Reverse-indexed from every bead's `dependencies`, so it is
   * populated without asking bd for it. */
  dependents: BeadDependency[];
  /** `paseo:<workspaceId>` when a Paseo workspace was created for this bead through the
   * plugin — the backlink that lets the panel match a bead to its workspace exactly. */
  externalRef: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface BeadStatusMeta {
  name: string;
  icon: string;
  category: string;
}

export interface BeadsMeta {
  types: string[];
  statuses: BeadStatusMeta[];
}

export interface ListOptions {
  limit: number;
}

export interface UpdatePatch {
  title?: string;
  description?: string;
  priority?: number;
  status?: string;
  issueType?: string;
  externalRef?: string;
  /** Compare-and-set: apply only if the bead is still in this status. */
  ifStatus?: string;
}

export interface CreatePatch {
  title: string;
  description?: string;
  priority?: number;
  issueType?: string;
}

export class BeadsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeadsUnavailableError";
  }
}

/** A compare-and-set guard was refused: the bead moved under us. */
export class BeadsConflictError extends BeadsUnavailableError {
  constructor(message = "That bead changed while you were editing it.") {
    super(message);
    this.name = "BeadsConflictError";
  }
}

// --- journal ----------------------------------------------------------------

export interface EventsRecord {
  seq: number;
  ts: string;
  op: "create" | "update" | "close" | "delete" | "dep_add" | "dep_remove" | "comment";
  issue_id: string;
  actor?: string;
  /** The bead's state after the mutation, null on a delete. Never inlines dependencies or
   * comments — those arrive as their own records. */
  issue?: RawIssue | null;
  dep?: { kind: string; target: string; metadata?: string };
  comment?: { id?: string; author?: string; text?: string };
}

/** Our checkpoint is below the oldest retained record: the span between is gone, and the only
 * correct move is to rebuild from current state. */
export interface EventsTruncated {
  code: "events_journal_truncated";
  since: number;
  floor: number;
  head: number;
}

export interface FollowHandlers {
  onRecord: (record: EventsRecord) => void;
  onTruncated: (info: EventsTruncated) => void;
  /** Null error means we stopped it ourselves. */
  onClosed: (error: string | null) => void;
}

// --- decoding ---------------------------------------------------------------

interface RawDependency {
  id?: string;
  depends_on_id?: string;
  title?: string;
  status?: string;
  dependency_type?: string;
  type?: string;
}

/** Every field but `id` is optional: a list omits the text, a journal snapshot omits more. */
export interface RawIssue {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
  parent?: string;
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
  dependencies?: RawDependency[];
  dependents?: RawDependency[];
  external_ref?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
}

function toDependency(raw: RawDependency): BeadDependency {
  return {
    id: raw.id ?? raw.depends_on_id ?? "",
    title: raw.title ?? "",
    status: raw.status ?? "",
    dependencyType: raw.dependency_type ?? raw.type ?? "blocks",
  };
}

export function toBeadIssue(raw: RawIssue): BeadIssue {
  return {
    id: raw.id,
    title: raw.title ?? "",
    description: raw.description ?? null,
    status: raw.status ?? "open",
    priority: raw.priority ?? 2,
    issueType: raw.issue_type ?? "task",
    assignee: raw.assignee ?? null,
    parent: raw.parent ?? null,
    dependencyCount: raw.dependency_count ?? 0,
    dependentCount: raw.dependent_count ?? 0,
    commentCount: raw.comment_count ?? 0,
    dependencies: (raw.dependencies ?? []).map(toDependency),
    dependents: (raw.dependents ?? []).map(toDependency),
    externalRef: raw.external_ref ?? null,
    createdAt: raw.created_at ?? "",
    updatedAt: raw.updated_at ?? "",
    closedAt: raw.closed_at ?? null,
  };
}
