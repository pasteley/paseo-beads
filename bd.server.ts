import { execFile } from "node:child_process";

const BD_BINARY = process.env.BD_BINARY ?? "bd";
const BD_TIMEOUT_MS = 15_000;

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
  /** Issues that depend on this one (the reverse direction) — only populated by
   * `getIssue`, which fetches with `--include-dependents`; empty from list/update/create. */
  dependents: BeadDependency[];
  /** `paseo:<workspaceId>` when a Paseo workspace was created for this bead through the
   * plugin — the backlink that lets `BeadsWorkspacePanel` match a bead to its workspace
   * exactly instead of guessing from the branch name. */
  externalRef: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

interface RawBeadDependency {
  id?: string;
  issue_id?: string;
  depends_on_id?: string;
  title?: string;
  status?: string;
  dependency_type?: string;
  type?: string;
}

interface RawBeadIssue {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  issue_type: string;
  assignee?: string;
  parent?: string;
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
  dependencies?: RawBeadDependency[];
  dependents?: RawBeadDependency[];
  external_ref?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
}

export class BeadsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeadsUnavailableError";
  }
}

function toBeadDependency(raw: RawBeadDependency): BeadDependency {
  return {
    id: raw.id ?? raw.depends_on_id ?? "",
    title: raw.title ?? "",
    status: raw.status ?? "",
    dependencyType: raw.dependency_type ?? raw.type ?? "blocks",
  };
}

function toBeadIssue(raw: RawBeadIssue): BeadIssue {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? null,
    status: raw.status,
    priority: raw.priority,
    issueType: raw.issue_type,
    assignee: raw.assignee ?? null,
    parent: raw.parent ?? null,
    dependencyCount: raw.dependency_count ?? 0,
    dependentCount: raw.dependent_count ?? 0,
    commentCount: raw.comment_count ?? 0,
    dependencies: (raw.dependencies ?? []).map(toBeadDependency),
    dependents: (raw.dependents ?? []).map(toBeadDependency),
    externalRef: raw.external_ref ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at ?? null,
  };
}

function runBd(cwd: string, args: readonly string[]): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(BD_BINARY, [...args], { cwd, timeout: BD_TIMEOUT_MS }, (error, stdout, stderr) => {
    if (!error) {
      resolve(stdout);
      return;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      reject(
        new BeadsUnavailableError(
          `bd binary not found on PATH. Install it (https://github.com/gastownhall/beads) or set BD_BINARY.`,
        ),
      );
      return;
    }
    reject(new BeadsUnavailableError(stderr.trim() || error.message));
  });
  return promise;
}

function parseIssueArray(stdout: string): BeadIssue[] {
  const parsed = JSON.parse(stdout) as RawBeadIssue[];
  return parsed.map(toBeadIssue);
}

function parseSingleIssue(stdout: string): BeadIssue {
  const parsed = JSON.parse(stdout) as RawBeadIssue;
  return toBeadIssue(parsed);
}

/** Cheap availability probe: does this directory have an initialized bd database? */
export async function isBeadsInitialized(cwd: string): Promise<boolean> {
  try {
    await runBd(cwd, ["list", "--json", "--limit", "1", "--no-pager"]);
    return true;
  } catch {
    return false;
  }
}

export interface ListIssuesOptions {
  all?: boolean;
  readyOnly?: boolean;
  limit?: number;
}

export async function listIssues(cwd: string, options: ListIssuesOptions = {}): Promise<BeadIssue[]> {
  const args = ["list", "--json", "--limit", String(options.limit ?? 200), "--no-pager"];
  if (options.all) args.push("--all");
  if (options.readyOnly) args.push("--ready");
  const stdout = await runBd(cwd, args);
  return parseIssueArray(stdout);
}

export interface UpdateIssuePatch {
  title?: string;
  description?: string;
  priority?: number;
  status?: string;
  issueType?: string;
  externalRef?: string;
}

export async function updateIssue(cwd: string, id: string, patch: UpdateIssuePatch): Promise<BeadIssue> {
  const args = ["update", id];
  if (patch.title !== undefined) args.push("--title", patch.title);
  if (patch.description !== undefined) args.push("--description", patch.description);
  if (patch.priority !== undefined) args.push("--priority", String(patch.priority));
  if (patch.status !== undefined) args.push("--status", patch.status);
  if (patch.issueType !== undefined) args.push("--type", patch.issueType);
  if (patch.externalRef !== undefined) args.push("--external-ref", patch.externalRef);
  args.push("--json");
  const stdout = await runBd(cwd, args);
  const issues = parseIssueArray(stdout);
  const [issue] = issues;
  if (!issue) throw new BeadsUnavailableError(`bd update returned no issue for ${id}`);
  return issue;
}

export interface CreateIssuePatch {
  title: string;
  description?: string;
  priority?: number;
  issueType?: string;
}

export async function createIssue(cwd: string, patch: CreateIssuePatch): Promise<BeadIssue> {
  const args = ["create", patch.title, "--json"];
  if (patch.description !== undefined) args.push("--description", patch.description);
  if (patch.priority !== undefined) args.push("--priority", String(patch.priority));
  if (patch.issueType !== undefined) args.push("--type", patch.issueType);
  const stdout = await runBd(cwd, args);
  return parseSingleIssue(stdout);
}

/** Runs `bd init` in a not-yet-initialized project root. `--non-interactive` keeps it from
 * blocking on the setup wizard (execFile has no tty, so bd would auto-detect this anyway —
 * passing it explicitly is just belt-and-suspenders). */
export async function initBeads(cwd: string): Promise<void> {
  await runBd(cwd, ["init", "--non-interactive"]);
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

interface RawTypeEntry {
  name?: string;
}
interface RawStatusEntry {
  name?: string;
  icon?: string;
  category?: string;
}

/** Pulls every array-of-objects out of the payload (built_in_*, core_types, custom_*, …) —
 * bd only includes the `custom_*` keys when custom vocab is configured, so we don't hard-code
 * the key names. */
function collectEntries<T>(payload: unknown): T[] {
  if (!payload || typeof payload !== "object") return [];
  const out: T[] = [];
  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") out.push(item as T);
      }
    }
  }
  return out;
}

/** Reads the type and status vocabularies `bd` accepts for this project. */
export async function getBeadsMeta(cwd: string): Promise<BeadsMeta> {
  const [typesOut, statusesOut] = await Promise.all([
    runBd(cwd, ["types", "--json"]),
    runBd(cwd, ["statuses", "--json"]),
  ]);

  const typeEntries = collectEntries<RawTypeEntry>(JSON.parse(typesOut));
  const statusEntries = collectEntries<RawStatusEntry>(JSON.parse(statusesOut));

  const types = [...new Set(typeEntries.map((entry) => entry.name).filter((name): name is string => Boolean(name)))];
  const statuses: BeadStatusMeta[] = [];
  const seenStatus = new Set<string>();
  for (const entry of statusEntries) {
    if (!entry.name || seenStatus.has(entry.name)) continue;
    seenStatus.add(entry.name);
    statuses.push({ name: entry.name, icon: entry.icon ?? "•", category: entry.category ?? "active" });
  }
  return { types, statuses };
}

/** Fetches one issue with both dependency directions resolved. `bd show` does not
 * accept `--no-pager` (only the list-style read commands do). */
export async function getIssue(cwd: string, id: string): Promise<BeadIssue> {
  const stdout = await runBd(cwd, ["show", id, "--json", "--include-dependents"]);
  const [issue] = parseIssueArray(stdout);
  if (!issue) throw new BeadsUnavailableError(`bd show returned no issue for ${id}`);
  return issue;
}

/** Permanently deletes an issue and removes/annotates references to it. `--force` is
 * required by bd or it only prints a dry-run preview and exits without deleting. */
export async function deleteIssue(cwd: string, id: string): Promise<void> {
  await runBd(cwd, ["delete", id, "--force", "--json"]);
}
