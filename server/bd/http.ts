import {
  BeadsConflictError,
  BeadsUnavailableError,
  toBeadIssue,
  type BeadIssue,
  type BeadsMeta,
  type CreatePatch,
  type EventsRecord,
  type EventsTruncated,
  type FollowHandlers,
  type ListOptions,
  type RawIssue,
  type UpdatePatch,
} from "./types";
import type { CliBeads } from "./cli";

const REQUEST_TIMEOUT_MS = 10_000;
const ACTOR = process.env.BD_ACTOR ?? "paseo-beads";

interface Problem {
  title?: string;
  code?: string;
  detail?: string;
  floor?: number;
  head?: number;
}

/** Every refusal on this API is RFC 9457 `problem+json`, whose `code` is a frozen vocabulary —
 * so a caller branches on the code instead of matching prose. */
export class BeadsHttpError extends BeadsUnavailableError {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly problem: Problem = {},
  ) {
    super(message);
    this.name = "BeadsHttpError";
  }
}

export interface ServeContext {
  bdVersion: string;
  projectId: string;
  capabilities: string[];
}

/** `bd serve` over loopback: no process per call, and the journal arrives as Server-Sent Events.
 * Operations the API does not serve — `bd init`, the type/status vocabularies, the journal's
 * config switch — fall through to the CLI backend this wraps. */
export class HttpBeads {
  readonly kind = "http" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly cli: CliBeads,
    private readonly token: string | null,
    private readonly context: ServeContext,
  ) {}

  version(): Promise<string | null> {
    return Promise.resolve(this.context.bdVersion || null);
  }

  get capabilities(): string[] {
    return this.context.capabilities;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      accept: "application/json",
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: this.headers(init?.body ? { "content-type": "application/json" } : undefined),
        signal: controller.signal,
      });
    } catch (error) {
      throw new BeadsUnavailableError(
        `bd serve at ${this.baseUrl} is unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const problem = ((await response.json().catch(() => null)) ?? {}) as Problem;
      throw new BeadsHttpError(
        problem.detail ?? problem.title ?? `bd serve answered ${response.status}`,
        response.status,
        problem.code ?? `http_${response.status}`,
        problem,
      );
    }
    return (await response.json()) as T;
  }

  /** `sort=priority` is the only served order that both matches `bd list` and has a cursor whose
   * key is total. */
  async list(options: ListOptions): Promise<BeadIssue[]> {
    const issues: BeadIssue[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ all: "true", sort: "priority", limit: String(Math.min(options.limit, 1000)) });
      if (cursor) query.set("cursor", cursor);
      const page = await this.request<{ items?: RawIssue[]; has_more?: boolean; next_cursor?: string }>(
        `/v0/beads/issues?${query}`,
      );
      for (const item of page.items ?? []) issues.push(toBeadIssue(item));
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor && issues.length < options.limit);
    return issues;
  }

  async get(id: string): Promise<BeadIssue> {
    return toBeadIssue(await this.request<RawIssue>(`/v0/beads/issues/${encodeURIComponent(id)}`));
  }

  async update(id: string, patch: UpdatePatch): Promise<BeadIssue> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.priority !== undefined) body.priority = patch.priority;
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.issueType !== undefined) body.issue_type = patch.issueType;
    if (patch.externalRef !== undefined) body.external_ref = patch.externalRef;

    try {
      const raw = await this.request<RawIssue>(`/v0/beads/issues/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          actor: ACTOR,
          patch: body,
          ...(patch.ifStatus !== undefined ? { expected_status: patch.ifStatus } : {}),
        }),
      });
      return toBeadIssue(raw);
    } catch (error) {
      if (error instanceof BeadsHttpError && error.code === "precondition_failed") throw new BeadsConflictError();
      throw error;
    }
  }

  async create(patch: CreatePatch): Promise<BeadIssue> {
    const raw = await this.request<RawIssue>("/v0/beads/issues", {
      method: "POST",
      body: JSON.stringify({
        actor: ACTOR,
        title: patch.title,
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.issueType !== undefined ? { issue_type: patch.issueType } : {}),
      }),
    });
    return toBeadIssue(raw);
  }

  /** `cascade` would delete the dependents too; the CLI's `--force` only annotates them. */
  async remove(id: string): Promise<void> {
    await this.request("/v0/beads/issues:delete", {
      method: "POST",
      body: JSON.stringify({ ids: [id], actor: ACTOR, cascade: false, force: true }),
    });
  }

  init(): Promise<void> {
    return this.cli.init();
  }

  meta(): Promise<BeadsMeta> {
    return this.cli.meta();
  }

  enableJournal(): Promise<void> {
    return this.cli.enableJournal();
  }

  /** A journal that is off is a typed 409 here rather than an empty page, so one paged read
   * answers both "can I follow?" and "from where?". */
  async journalEnabled(): Promise<boolean> {
    if (this.capabilities.length > 0 && !this.capabilities.includes("events.watch")) return false;
    try {
      await this.journalHead();
      return true;
    } catch (error) {
      if (error instanceof BeadsHttpError && error.code === "events_journal_disabled") return false;
      throw error;
    }
  }

  async journalHead(): Promise<number> {
    try {
      const page = await this.request<{ head?: number }>("/v0/beads/events?since=0&limit=1");
      return page.head ?? 0;
    } catch (error) {
      // A pruned journal refuses `since=0`, and reports the head we wanted in the refusal.
      if (error instanceof BeadsHttpError && error.code === "events_journal_truncated") {
        return error.problem.head ?? 0;
      }
      throw error;
    }
  }

  follow(since: number, handlers: FollowHandlers): () => void {
    const controller = new AbortController();
    let stopped = false;
    const close = (error: string | null) => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      handlers.onClosed(error);
    };

    void (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/v0/beads/events:watch?since=${since}`, {
          headers: this.headers({ accept: "text/event-stream" }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const problem = ((await response.json().catch(() => null)) ?? {}) as Problem;
          close(problem.code ?? `bd serve answered ${response.status}`);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          if (stopped) return;
          buffer += decoder.decode(chunk, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            handleFrame(buffer.slice(0, boundary), handlers);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
          }
        }
        close("bd serve closed the event stream");
      } catch (error) {
        close(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => close(null);
  }
}

/** One SSE frame: `data:` carries a record, `event: truncated` carries the stop-and-rebaseline
 * refusal, and a `:` line is a keepalive. */
function handleFrame(frame: string, handlers: FollowHandlers): void {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":") || line.trim() === "") continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join("\n"));
  } catch {
    return;
  }
  if (event === "truncated") {
    const info = parsed as Partial<EventsTruncated>;
    handlers.onTruncated({
      code: "events_journal_truncated",
      since: info.since ?? 0,
      floor: info.floor ?? 0,
      head: info.head ?? 0,
    });
    return;
  }
  const record = parsed as EventsRecord;
  if (typeof record.seq === "number" && typeof record.op === "string") handlers.onRecord(record);
}
