import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { output as ZodOutput } from "zod";
import { BeadsConflictError, BeadsUnavailableError } from "./bd";
import { getBeadsFeed } from "./feed";
import type {
  BeadsMetaResult,
  CreateBeadResult,
  DeleteBeadResult,
  EnableBeadEventsResult,
  GetBeadResult,
  InitBeadsResult,
  ListBeadsResult,
  UpdateBeadResult,
  beadsMetaRpc,
  createBeadRpc,
  deleteBeadRpc,
  enableBeadEventsRpc,
  getBeadRpc,
  initBeadsRpc,
  listBeadsRpc,
  updateBeadRpc,
} from "../shared/beads";

/** Early returns never reach a feed, so they have nothing to report about bd. */
const NO_FEED = {
  revision: 0,
  unchanged: false,
  mode: "poll",
  transport: "cli",
  bdVersion: null,
  supportsEvents: false,
  journalEnabled: false,
  transportError: null,
} as const;

async function resolveProjectRoot(
  paseo: PluginHandlerContext["paseo"],
  projectId: string,
): Promise<string | null> {
  const { projects } = await paseo.projects.list();
  return projects.find((entry) => entry.projectId === projectId)?.projectRootPath ?? null;
}

function message(error: unknown, fallback: string): string {
  return error instanceof BeadsUnavailableError ? error.message : fallback;
}

export async function listBeads(
  { projectId, sinceRevision }: ZodOutput<typeof listBeadsRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<ListBeadsResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) {
    return { ...NO_FEED, available: false, issues: [], error: "Project not found." };
  }

  const snapshot = await getBeadsFeed(projectRootPath).snapshot();
  if (!snapshot.available) {
    return {
      ...NO_FEED,
      available: false,
      issues: [],
      error: snapshot.error ?? "No bd database found for this project. Run `bd init` in its root checkout.",
    };
  }

  const unchanged = sinceRevision !== undefined && sinceRevision === snapshot.revision;
  return {
    available: true,
    issues: unchanged ? [] : snapshot.issues,
    error: snapshot.error,
    revision: snapshot.revision,
    unchanged,
    mode: snapshot.mode,
    transport: snapshot.transport,
    bdVersion: snapshot.bdVersion,
    supportsEvents: snapshot.supportsEvents,
    journalEnabled: snapshot.journalEnabled,
    transportError: snapshot.transportError,
  };
}

export async function enableBeadEvents(
  { projectId }: ZodOutput<typeof enableBeadEventsRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<EnableBeadEventsResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) return { ok: false, error: "Project not found." };

  try {
    await getBeadsFeed(projectRootPath).enableEvents();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: message(error, "Failed to enable the bd events journal.") };
  }
}

export async function initBead(
  { projectId }: ZodOutput<typeof initBeadsRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<InitBeadsResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) return { ok: false, error: "Project not found." };

  const feed = getBeadsFeed(projectRootPath);
  if ((await feed.snapshot()).available) return { ok: true, error: null };

  try {
    await (await feed.resolve()).init();
    await feed.reload();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: message(error, "Failed to run `bd init`.") };
  }
}

export async function beadsMeta(
  { projectId }: ZodOutput<typeof beadsMetaRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<BeadsMetaResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) return { types: [], statuses: [], error: "Project not found." };

  try {
    return { ...(await getBeadsFeed(projectRootPath).vocabulary()), error: null };
  } catch (error) {
    return { types: [], statuses: [], error: message(error, "Failed to load bd types/statuses.") };
  }
}

export async function updateBead(
  { projectId, id, ...patch }: ZodOutput<typeof updateBeadRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<UpdateBeadResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) return { issue: null, error: "Project not found.", conflict: false };

  const feed = getBeadsFeed(projectRootPath);
  try {
    const backend = await feed.resolve();
    const issue = await backend.update(id, feed.supportsGuards ? patch : { ...patch, ifStatus: undefined });
    feed.applyWrite(issue);
    return { issue, error: null, conflict: false };
  } catch (error) {
    if (error instanceof BeadsConflictError) {
      // The panel reloads rather than re-applies: what it was editing is out of date.
      void feed.refresh();
      return { issue: null, error: error.message, conflict: true };
    }
    return { issue: null, error: message(error, "Failed to update bead."), conflict: false };
  }
}

export async function createBead(
  { projectId, ...patch }: ZodOutput<typeof createBeadRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<CreateBeadResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) return { issue: null, error: "Project not found." };

  const feed = getBeadsFeed(projectRootPath);
  try {
    const issue = await (await feed.resolve()).create(patch);
    feed.applyWrite(issue);
    return { issue, error: null };
  } catch (error) {
    return { issue: null, error: message(error, "Failed to create bead.") };
  }
}

export async function getBead(
  { projectId, id }: ZodOutput<typeof getBeadRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<GetBeadResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) return { issue: null, error: "Project not found." };

  const feed = getBeadsFeed(projectRootPath);
  try {
    const issue = await (await feed.resolve()).get(id);
    feed.applyDetail(issue);
    return { issue, error: null };
  } catch (error) {
    return { issue: null, error: message(error, "Failed to load bead.") };
  }
}

export async function deleteBead(
  { projectId, id }: ZodOutput<typeof deleteBeadRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<DeleteBeadResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) return { deleted: false, error: "Project not found." };

  const feed = getBeadsFeed(projectRootPath);
  try {
    await (await feed.resolve()).remove(id);
    feed.applyDelete(id);
    return { deleted: true, error: null };
  } catch (error) {
    return { deleted: false, error: message(error, "Failed to delete bead.") };
  }
}
