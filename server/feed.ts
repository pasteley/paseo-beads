import {
  BeadsUnavailableError,
  resolveBackend,
  supportsJournal,
  toBeadIssue,
  type BeadIssue,
  type BeadsBackend,
  type BeadsMeta,
  type EventsRecord,
  type RawIssue,
} from "./bd";

/** `live`: following the journal. `poll`: no journal, so the cache is a list snapshot. */
export type BeadsFeedMode = "live" | "poll";

export interface BeadsSnapshot {
  available: boolean;
  issues: BeadIssue[];
  /** Moves only when the issue set changes, so a poll can be answered "nothing new". */
  revision: number;
  mode: BeadsFeedMode;
  transport: "cli" | "http";
  bdVersion: string | null;
  supportsEvents: boolean;
  journalEnabled: boolean;
  error: string | null;
  /** A configured `bd serve` that could not be reached. Kept apart from `error` so it reads as
   * a notice rather than a failed read — the CLI fallback works. */
  transportError: string | null;
}

const LIST_LIMIT = 1000;
const META_TTL_MS = 10 * 60_000;
/** Poll mode: how long a list snapshot is reused before fetching again. */
const POLL_STALE_MS = 3_000;
const RECONCILE_DEBOUNCE_MS = 250;
/** Not set up yet: how often to look again, so a `bd init` typed in a terminal is noticed. */
const UNAVAILABLE_RECHECK_MS = 10_000;
/** No snapshot asked for in this long → stop following (the panel is closed). */
const IDLE_STOP_MS = 60_000;
const RESTART_DELAY_MS = 5_000;

/** A record never inlines dependencies or comments, so those come from the cached bead; every
 * scalar it does carry wins. */
function applyRecordSnapshot(existing: BeadIssue | undefined, raw: RawIssue): BeadIssue {
  const base = existing ?? toBeadIssue(raw);
  return {
    ...base,
    id: raw.id,
    title: raw.title ?? base.title,
    description: raw.description !== undefined ? raw.description : base.description,
    status: raw.status ?? base.status,
    priority: raw.priority ?? base.priority,
    issueType: raw.issue_type ?? base.issueType,
    assignee: raw.assignee !== undefined ? raw.assignee : base.assignee,
    parent: raw.parent !== undefined ? raw.parent : base.parent,
    externalRef: raw.external_ref !== undefined ? raw.external_ref : base.externalRef,
    createdAt: raw.created_at ?? base.createdAt,
    updatedAt: raw.updated_at ?? base.updatedAt,
    closedAt: raw.closed_at !== undefined ? raw.closed_at : base.closedAt,
  };
}

/** Adds the one thing a list response doesn't carry: the reverse dependency edges, which are a
 * reverse index over the `dependencies` every bead already lists. Their titles and statuses come
 * back empty too, so they are filled from the beads themselves.
 *
 * Counts are derived from the arrays because they are not reliable in list output: a bead whose
 * `dependencies` array has an entry can still report `dependency_count: 0`. */
function index(issues: BeadIssue[], previous: Map<string, BeadIssue>): Map<string, BeadIssue> {
  const next = new Map<string, BeadIssue>();
  for (const issue of issues) {
    next.set(issue.id, {
      ...issue,
      // A listed bead's text is whatever the list says; absent means empty, not unfetched.
      description: issue.description ?? previous.get(issue.id)?.description ?? "",
      dependents: [],
    });
  }

  for (const issue of next.values()) {
    for (const dependency of issue.dependencies) {
      const target = next.get(dependency.id);
      if (!target) continue;
      dependency.title ||= target.title;
      dependency.status ||= target.status;
      target.dependents.push({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        dependencyType: dependency.dependencyType,
      });
    }
  }

  for (const issue of next.values()) {
    issue.dependencyCount = Math.max(issue.dependencyCount, issue.dependencies.length);
    issue.dependentCount = Math.max(issue.dependentCount, issue.dependents.length);
  }
  return next;
}

/** One project root's beads, kept in step with bd instead of re-read on a timer.
 *
 * Baseline then follow: the journal doesn't backfill what happened before it was switched on, so
 * the cache starts from a full list and advances from the journal's head. Reading the head
 * *before* the baseline means a record committed between the two replays rather than being lost.
 */
class ProjectFeed {
  private backend: BeadsBackend | null = null;
  private issues = new Map<string, BeadIssue>();
  private revision = 0;
  private mode: BeadsFeedMode = "poll";
  private available = false;
  private bdVersion: string | null = null;
  private supportsEvents = false;
  private journalEnabled = false;
  private error: string | null = null;
  private transportError: string | null = null;
  private seq = 0;

  private started: Promise<void> | null = null;
  private listing: Promise<void> | null = null;
  private meta: { value: BeadsMeta; at: number } | null = null;
  private lastListAt = 0;
  private lastStartAt = 0;
  private lastAccessAt = 0;
  /** JSON of the last list, to tell a no-op fetch from a real change. */
  private signature: string | null = null;
  /** Keeps a transient list failure from reading as "no database". */
  private hasListed = false;

  private stopFollow: (() => void) | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly cwd: string) {}

  async snapshot(): Promise<BeadsSnapshot> {
    this.lastAccessAt = Date.now();
    this.armIdleTimer();
    await this.ensureStarted();
    if (!this.available && Date.now() - this.lastStartAt > UNAVAILABLE_RECHECK_MS) await this.restart();
    else if (this.mode === "poll" && this.available && Date.now() - this.lastListAt > POLL_STALE_MS) {
      await this.refetch();
    }
    return {
      available: this.available,
      issues: [...this.issues.values()],
      revision: this.revision,
      mode: this.mode,
      transport: this.backend?.kind ?? "cli",
      bdVersion: this.bdVersion,
      supportsEvents: this.supportsEvents,
      journalEnabled: this.journalEnabled,
      error: this.error,
      transportError: this.transportError,
    };
  }

  /** The backend handlers write through, so a write takes the same route as a read. */
  async resolve(): Promise<BeadsBackend> {
    await this.ensureStarted();
    return this.current;
  }

  /** Inside `start()` the backend is already picked but `started` is still pending, so anything
   * on that path takes the backend directly — awaiting `resolve()` there would deadlock. */
  private get current(): BeadsBackend {
    if (!this.backend) throw new BeadsUnavailableError("No bd backend for this project.");
    return this.backend;
  }

  /** False while unknown, so a guard is dropped rather than sent to a bd that would reject it. */
  get supportsGuards(): boolean {
    return this.supportsEvents;
  }

  /** Writes land in the cache as they return, not when their record arrives. */
  applyWrite(issue: BeadIssue): void {
    this.issues.set(issue.id, issue);
    this.touch();
  }

  applyDelete(id: string): void {
    if (this.issues.delete(id)) this.touch();
    this.scheduleReconcile();
  }

  /** Folds a detail fetch in. Normalizing null to "" keeps a bead with no description from
   * looking unfetched and being fetched again on every open. */
  applyDetail(issue: BeadIssue): void {
    const resolved = { ...issue, description: issue.description ?? "" };
    if (this.issues.get(issue.id)?.description === resolved.description) return;
    this.issues.set(issue.id, resolved);
    this.touch();
  }

  async vocabulary(): Promise<BeadsMeta> {
    if (this.meta && Date.now() - this.meta.at < META_TTL_MS) return this.meta.value;
    const value = await (await this.resolve()).meta();
    this.meta = { value, at: Date.now() };
    return value;
  }

  async enableEvents(): Promise<void> {
    await (await this.resolve()).enableJournal();
    this.stop();
    await this.ensureStarted();
  }

  /** Force a re-read — used after a refused compare-and-set. */
  async refresh(): Promise<void> {
    this.signature = null;
    await this.refetch();
  }

  /** After `bd init`: forget everything and start over. */
  async reload(): Promise<void> {
    this.stop();
    this.issues.clear();
    this.signature = null;
    this.available = false;
    this.hasListed = false;
    this.seq = 0;
    this.lastStartAt = 0;
    await this.ensureStarted();
  }

  stop(): void {
    this.stopFollow?.();
    this.stopFollow = null;
    for (const timer of [this.reconcileTimer, this.restartTimer, this.idleTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.reconcileTimer = null;
    this.restartTimer = null;
    this.idleTimer = null;
    this.started = null;
    this.mode = "poll";
  }

  private ensureStarted(): Promise<void> {
    this.started ??= this.start().catch((error: unknown) => {
      this.error = error instanceof Error ? error.message : "Failed to start the beads feed.";
    });
    return this.started;
  }

  private async start(): Promise<void> {
    this.lastStartAt = Date.now();
    const resolved = await resolveBackend(this.cwd);
    this.backend = resolved.backend;
    this.transportError = resolved.error;

    this.bdVersion = await this.backend.version();
    this.supportsEvents = supportsJournal(this.bdVersion);

    try {
      this.journalEnabled = this.supportsEvents && (await this.backend.journalEnabled());
    } catch {
      this.journalEnabled = false;
    }

    if (!this.journalEnabled) {
      this.mode = "poll";
      await this.refetch();
      return;
    }

    // A checkpoint we already hold survives an idle stop, so reopening the panel costs one list
    // and no journal scan.
    if (this.seq === 0) this.seq = await this.backend.journalHead();
    await this.refetch();
    if (!this.available) return;
    this.startFollow();
    this.mode = "live";
  }

  private startFollow(): void {
    this.stopFollow?.();
    this.stopFollow =
      this.backend?.follow(this.seq, {
        onRecord: (record) => this.applyRecord(record),
        onTruncated: () => {
          // Our checkpoint fell below the retained window; resuming from it is refused forever.
          this.seq = 0;
          void this.restart();
        },
        onClosed: (error) => {
          if (error === null) return;
          this.mode = "poll";
          this.error = error;
          this.scheduleRestart();
        },
      }) ?? null;
  }

  private applyRecord(record: EventsRecord): void {
    this.seq = Math.max(this.seq, record.seq);
    switch (record.op) {
      case "create":
      case "update":
      case "close": {
        if (!record.issue) {
          this.scheduleReconcile();
          break;
        }
        const previous = this.issues.get(record.issue.id);
        const issue = applyRecordSnapshot(previous, record.issue);
        this.issues.set(issue.id, issue);
        if (previous?.title !== issue.title || previous?.status !== issue.status) this.syncLinkRows(issue);
        this.touch();
        break;
      }
      // Both of these move counts and the epic `parent` on beads the record doesn't name, so
      // they re-index from a list rather than patch the graph here.
      case "delete": {
        this.issues.delete(record.issue_id);
        this.touch();
        this.scheduleReconcile();
        break;
      }
      case "dep_add":
      case "dep_remove": {
        this.scheduleReconcile();
        break;
      }
      case "comment": {
        const issue = this.issues.get(record.issue_id);
        if (!issue) break;
        this.issues.set(issue.id, { ...issue, commentCount: issue.commentCount + 1 });
        this.touch();
        break;
      }
    }
  }

  /** Link rows hold a copy of the linked bead's title and status, so a record moving either has
   * to reach the copies too. */
  private syncLinkRows(issue: BeadIssue): void {
    for (const other of this.issues.values()) {
      for (const row of [...other.dependencies, ...other.dependents]) {
        if (row.id !== issue.id) continue;
        row.title = issue.title;
        row.status = issue.status;
      }
    }
  }

  private touch(): void {
    this.revision += 1;
    this.signature = null;
  }

  private scheduleReconcile(): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      void this.refetch();
    }, RECONCILE_DEBOUNCE_MS);
    this.reconcileTimer.unref();
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (Date.now() - this.lastAccessAt > IDLE_STOP_MS) return;
      void this.restart();
    }, RESTART_DELAY_MS);
    this.restartTimer.unref();
  }

  private async restart(): Promise<void> {
    this.stopFollow?.();
    this.stopFollow = null;
    this.started = null;
    await this.ensureStarted();
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (Date.now() - this.lastAccessAt < IDLE_STOP_MS) return;
      this.stop();
    }, IDLE_STOP_MS);
    this.idleTimer.unref();
  }

  private refetch(): Promise<void> {
    this.listing ??= this.runList().finally(() => {
      this.listing = null;
    });
    return this.listing;
  }

  private async runList(): Promise<void> {
    try {
      const issues = await this.current.list({ limit: LIST_LIMIT });
      this.available = true;
      this.hasListed = true;
      const signature = JSON.stringify(issues);
      if (signature !== this.signature) {
        this.issues = index(issues, this.issues);
        this.signature = signature;
        this.revision += 1;
      }
      this.error = null;
    } catch (error) {
      this.error = error instanceof BeadsUnavailableError ? error.message : "Failed to list beads.";
      if (!this.hasListed) this.available = false;
    }
    this.lastListAt = Date.now();
  }
}

const feeds = new Map<string, ProjectFeed>();

export function getBeadsFeed(projectRootPath: string): ProjectFeed {
  let feed = feeds.get(projectRootPath);
  if (!feed) {
    feed = new ProjectFeed(projectRootPath);
    feeds.set(projectRootPath, feed);
  }
  return feed;
}

/** Plugin cleanup: closes every open journal follower. */
export function stopAllBeadsFeeds(): void {
  for (const feed of feeds.values()) feed.stop();
  feeds.clear();
}

export type { ProjectFeed };
