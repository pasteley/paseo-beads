import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  BeadsConflictError,
  BeadsUnavailableError,
  toBeadIssue,
  type BeadIssue,
  type BeadsMeta,
  type BeadStatusMeta,
  type CreatePatch,
  type EventsRecord,
  type EventsTruncated,
  type FollowHandlers,
  type ListOptions,
  type RawIssue,
  type UpdatePatch,
} from "./types";

const BD_BINARY = process.env.BD_BINARY ?? "bd";
const BD_TIMEOUT_MS = 15_000;

interface RunResult {
  stdout: string;
  /** Kept on success too: a refused guard reports itself here while exiting 0. */
  stderr: string;
}

function run(cwd: string, args: readonly string[]): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  execFile(BD_BINARY, [...args], { cwd, timeout: BD_TIMEOUT_MS }, (error, stdout, stderr) => {
    if (!error) {
      resolve({ stdout, stderr });
      return;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      reject(
        new BeadsUnavailableError(
          "bd binary not found on PATH. Install it (https://github.com/gastownhall/beads) or set BD_BINARY.",
        ),
      );
      return;
    }
    reject(new BeadsUnavailableError(stderr.trim() || error.message));
  });
  return promise;
}

/** bd answers with all three of a bare array (`list`, `update`, `show`), a single object
 * (`create`) and an `{issues, …}` envelope (anything with `--skip-labels`). */
function parseIssues(stdout: string): BeadIssue[] {
  const parsed = JSON.parse(stdout) as RawIssue[] | { issues?: RawIssue[] } | RawIssue;
  if (Array.isArray(parsed)) return parsed.map(toBeadIssue);
  if ("issues" in parsed && Array.isArray(parsed.issues)) return parsed.issues.map(toBeadIssue);
  return "id" in parsed && typeof parsed.id === "string" ? [toBeadIssue(parsed)] : [];
}

/** A refused `--if-status` guard is not an error exit: bd writes this to stderr and exits 0, so
 * the outcome has to be read out of the payload rather than the exit status. */
function guardRefused(text: string): boolean {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as { failed?: { guard_mismatch?: boolean }[] };
      if (parsed.failed?.some((entry) => entry.guard_mismatch)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function parseJournalLine(line: string): EventsRecord | EventsTruncated | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const candidate = parsed as Partial<EventsRecord> & Partial<EventsTruncated>;
  if (candidate.code === "events_journal_truncated") {
    return {
      code: "events_journal_truncated",
      since: candidate.since ?? 0,
      floor: candidate.floor ?? 0,
      head: candidate.head ?? 0,
    };
  }
  if (typeof candidate.seq === "number" && typeof candidate.op === "string") return parsed as EventsRecord;
  return null;
}

/** Streams stdout line by line, so a `--follow` tail and a 100k-record dump are both O(1). */
function stream(cwd: string, args: readonly string[], onLine: (line: string) => void) {
  const child = spawn(BD_BINARY, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", onLine);

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4096);
  });

  const { promise, resolve } = Promise.withResolvers<{ code: number | null; stderr: string }>();
  child.on("error", (error) => {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    resolve({ code: null, stderr: missing ? "bd binary not found on PATH." : error.message });
  });
  child.on("close", (code) => {
    lines.close();
    resolve({ code, stderr });
  });
  return { kill: () => child.kill(), done: promise };
}

/** Pulls every array-of-objects out of a payload: bd only includes its `custom_*` keys when
 * custom vocab is configured, so the key names can't be hard-coded. */
function collectEntries<T>(payload: unknown): T[] {
  if (!payload || typeof payload !== "object") return [];
  const out: T[] = [];
  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) if (item && typeof item === "object") out.push(item as T);
  }
  return out;
}

export class CliBeads {
  readonly kind = "cli" as const;

  constructor(private readonly cwd: string) {}

  /** `bd version --json`, falling back to scraping `--version`. Null means unknown. */
  async version(): Promise<string | null> {
    try {
      const parsed = JSON.parse((await run(this.cwd, ["version", "--json"])).stdout) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // fall through
    }
    try {
      return /(\d+\.\d+\.\d+)/.exec((await run(this.cwd, ["--version"])).stdout)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  async list(options: ListOptions): Promise<BeadIssue[]> {
    // Everything the panel shows in one call — text and dependency rows included — so opening a
    // bead never waits on a second fetch.
    const args = ["list", "--json", "--all", "--limit", String(options.limit), "--no-pager", "--skip-labels"];
    return parseIssues((await run(this.cwd, args)).stdout);
  }

  /** `bd show` resolves the reverse dependency direction and the free-form text; it does not
   * accept `--no-pager`. */
  async get(id: string): Promise<BeadIssue> {
    const [issue] = parseIssues((await run(this.cwd, ["show", id, "--json", "--include-dependents"])).stdout);
    if (!issue) throw new BeadsUnavailableError(`bd show returned no issue for ${id}`);
    return issue;
  }

  async update(id: string, patch: UpdatePatch): Promise<BeadIssue> {
    const args = ["update", id];
    if (patch.ifStatus !== undefined) args.push("--if-status", patch.ifStatus);
    if (patch.title !== undefined) args.push("--title", patch.title);
    if (patch.description !== undefined) args.push("--description", patch.description);
    if (patch.priority !== undefined) args.push("--priority", String(patch.priority));
    if (patch.status !== undefined) args.push("--status", patch.status);
    if (patch.issueType !== undefined) args.push("--type", patch.issueType);
    if (patch.externalRef !== undefined) args.push("--external-ref", patch.externalRef);
    args.push("--json");

    let result: RunResult;
    try {
      result = await run(this.cwd, args);
    } catch (error) {
      if (error instanceof Error && guardRefused(error.message)) throw new BeadsConflictError();
      throw error;
    }
    if (guardRefused(result.stderr)) throw new BeadsConflictError();

    const [issue] = parseIssues(result.stdout || "[]");
    if (!issue) throw new BeadsUnavailableError(result.stderr.trim() || `bd update returned no issue for ${id}`);
    return issue;
  }

  async create(patch: CreatePatch): Promise<BeadIssue> {
    const args = ["create", patch.title, "--json"];
    if (patch.description !== undefined) args.push("--description", patch.description);
    if (patch.priority !== undefined) args.push("--priority", String(patch.priority));
    if (patch.issueType !== undefined) args.push("--type", patch.issueType);
    const [issue] = parseIssues((await run(this.cwd, args)).stdout);
    if (!issue) throw new BeadsUnavailableError("bd create returned no issue");
    return issue;
  }

  /** `--force` is required or bd only prints a dry-run preview. */
  async remove(id: string): Promise<void> {
    await run(this.cwd, ["delete", id, "--force", "--json"]);
  }

  /** `--non-interactive` keeps `bd init` from blocking on the setup wizard. */
  async init(): Promise<void> {
    await run(this.cwd, ["init", "--non-interactive"]);
  }

  async meta(): Promise<BeadsMeta> {
    const [types, statuses] = await Promise.all([
      run(this.cwd, ["types", "--json"]),
      run(this.cwd, ["statuses", "--json"]),
    ]);
    const typeNames = collectEntries<{ name?: string }>(JSON.parse(types.stdout))
      .map((entry) => entry.name)
      .filter((name): name is string => Boolean(name));
    const statusMeta: BeadStatusMeta[] = [];
    const seen = new Set<string>();
    for (const entry of collectEntries<{ name?: string; icon?: string; category?: string }>(JSON.parse(statuses.stdout))) {
      if (!entry.name || seen.has(entry.name)) continue;
      seen.add(entry.name);
      statusMeta.push({ name: entry.name, icon: entry.icon ?? "•", category: entry.category ?? "active" });
    }
    return { types: [...new Set(typeNames)], statuses: statusMeta };
  }

  /** Written to `.beads/config.yaml`, so every later `bd` in the checkout inherits it — agents
   * included. Only ever called from an explicit click. */
  async journalEnabled(): Promise<boolean> {
    const parsed = JSON.parse((await run(this.cwd, ["config", "get", "events-journal", "--json"])).stdout) as {
      value?: unknown;
    };
    return parsed.value === true || parsed.value === "true" || parsed.value === "1";
  }

  async enableJournal(): Promise<void> {
    await run(this.cwd, ["config", "set", "events-journal", "true"]);
  }

  /** The CLI has no "what is the head" command, so this streams the journal and keeps the
   * highest seq. A pruned journal refuses `--since 0` and reports the head in the refusal. */
  async journalHead(): Promise<number> {
    const state: { head: number; truncated: EventsTruncated | null } = { head: 0, truncated: null };
    const { done } = stream(this.cwd, ["events", "tail", "--since", "0"], (line) => {
      const parsed = parseJournalLine(line);
      if (!parsed) return;
      if ("code" in parsed) state.truncated = parsed;
      else state.head = Math.max(state.head, parsed.seq);
    });
    const { code, stderr } = await done;
    const refusal =
      state.truncated ??
      stderr
        .split("\n")
        .map(parseJournalLine)
        .find((parsed): parsed is EventsTruncated => Boolean(parsed && "code" in parsed));
    if (refusal) return refusal.head;
    if (code !== 0) throw new BeadsUnavailableError(stderr.trim() || `bd events tail exited with ${code}`);
    return state.head;
  }

  follow(since: number, handlers: FollowHandlers): () => void {
    let stopped = false;
    const { kill, done } = stream(this.cwd, ["events", "tail", "--since", String(since), "--follow"], (line) => {
      if (stopped) return;
      const parsed = parseJournalLine(line);
      if (!parsed) return;
      if ("code" in parsed) handlers.onTruncated(parsed);
      else handlers.onRecord(parsed);
    });
    void done.then(({ code, stderr }) => {
      if (!stopped) handlers.onClosed(stderr.trim() || `bd events tail exited with ${code}`);
    });
    return () => {
      if (stopped) return;
      stopped = true;
      kill();
      handlers.onClosed(null);
    };
  }
}
