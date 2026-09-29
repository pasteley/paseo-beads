import { MIN_BD_VERSION } from "../../shared/beads";
import { CliBeads } from "./cli";
import { BeadsHttpError, HttpBeads, type ServeContext } from "./http";

export * from "./types";
export { BeadsHttpError };

/** The two interchangeable ways to reach bd. Both satisfy the same surface, so nothing above
 * this module branches on which one it holds. */
export type BeadsBackend = CliBeads | HttpBeads;

const SERVE_URL = process.env.BD_SERVE_URL?.replace(/\/+$/, "") ?? null;
const SERVE_TOKEN = process.env.BD_SERVE_TOKEN ?? null;

/** Picks a backend for a project root: the `bd serve` named by `BD_SERVE_URL` when it answers
 * its handshake, else the CLI. `bd serve` needs a Dolt server-mode workspace and is opt-in, so
 * the CLI is the normal case and the fallback for every failure.
 *
 * `error` is set when a configured server could not be reached — the caller surfaces it rather
 * than silently degrading. */
export async function resolveBackend(cwd: string): Promise<{ backend: BeadsBackend; error: string | null }> {
  const cli = new CliBeads(cwd);
  if (!SERVE_URL) return { backend: cli, error: null };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(`${SERVE_URL}/v0/beads/context`, {
      headers: {
        accept: "application/json",
        ...(SERVE_TOKEN ? { authorization: `Bearer ${SERVE_TOKEN}` } : {}),
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error(`context answered ${response.status}`);

    const raw = (await response.json()) as { bd_version?: string; project_id?: string; capabilities?: string[] };
    const context: ServeContext = {
      bdVersion: raw.bd_version ?? "",
      projectId: raw.project_id ?? "",
      capabilities: raw.capabilities ?? [],
    };
    return { backend: new HttpBeads(SERVE_URL, cli, SERVE_TOKEN, context), error: null };
  } catch (error) {
    return {
      backend: cli,
      error: `bd serve at ${SERVE_URL} did not answer (${error instanceof Error ? error.message : String(error)}); using the CLI.`,
    };
  }
}

/** Below this, bd has no events journal and no compare-and-set guards. Unknown counts as old. */
export function supportsJournal(version: string | null): boolean {
  if (version === null) return false;
  const parse = (value: string) =>
    value
      .split("-")[0]!
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(version);
  const right = parse(MIN_BD_VERSION);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}
