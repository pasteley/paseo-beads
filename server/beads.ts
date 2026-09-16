import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { output as ZodOutput } from "zod";
import {
  BeadsUnavailableError,
  createIssue,
  deleteIssue,
  getBeadsMeta,
  getIssue,
  initBeads,
  isBeadsInitialized,
  listIssues,
  updateIssue,
} from "./bd";
import type {
  BeadsMetaResult,
  CreateBeadResult,
  DeleteBeadResult,
  GetBeadResult,
  InitBeadsResult,
  ListBeadsResult,
  UpdateBeadResult,
  beadsMetaRpc,
  createBeadRpc,
  deleteBeadRpc,
  getBeadRpc,
  initBeadsRpc,
  listBeadsRpc,
  updateBeadRpc,
} from "../shared/beads";

async function resolveProjectRoot(
  paseo: PluginHandlerContext["paseo"],
  projectId: string,
): Promise<string | null> {
  const { projects } = await paseo.projects.list();
  return projects.find((entry) => entry.projectId === projectId)?.projectRootPath ?? null;
}

export async function listBeads(
  { projectId }: ZodOutput<typeof listBeadsRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<ListBeadsResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) {
    return { available: false, issues: [], error: "Project not found." };
  }

  const available = await isBeadsInitialized(projectRootPath);
  if (!available) {
    return {
      available: false,
      issues: [],
      error: "No bd database found for this project. Run `bd init` in its root checkout.",
    };
  }

  try {
    const issues = await listIssues(projectRootPath, { all: true });
    return { available: true, issues, error: null };
  } catch (error) {
    const message = error instanceof BeadsUnavailableError ? error.message : "Failed to list beads.";
    return { available: true, issues: [], error: message };
  }
}

export async function initBead(
  { projectId }: ZodOutput<typeof initBeadsRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<InitBeadsResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) {
    return { ok: false, error: "Project not found." };
  }

  if (await isBeadsInitialized(projectRootPath)) {
    return { ok: true, error: null };
  }

  try {
    await initBeads(projectRootPath);
    return { ok: true, error: null };
  } catch (error) {
    const message = error instanceof BeadsUnavailableError ? error.message : "Failed to run `bd init`.";
    return { ok: false, error: message };
  }
}

export async function beadsMeta(
  { projectId }: ZodOutput<typeof beadsMetaRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<BeadsMetaResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) {
    return { types: [], statuses: [], error: "Project not found." };
  }

  try {
    const meta = await getBeadsMeta(projectRootPath);
    return { ...meta, error: null };
  } catch (error) {
    const message = error instanceof BeadsUnavailableError ? error.message : "Failed to load bd types/statuses.";
    return { types: [], statuses: [], error: message };
  }
}

export async function updateBead(
  { projectId, id, ...patch }: ZodOutput<typeof updateBeadRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<UpdateBeadResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) {
    return { issue: null, error: "Project not found." };
  }

  try {
    const issue = await updateIssue(projectRootPath, id, patch);
    return { issue, error: null };
  } catch (error) {
    const message = error instanceof BeadsUnavailableError ? error.message : "Failed to update bead.";
    return { issue: null, error: message };
  }
}

export async function createBead(
  { projectId, ...patch }: ZodOutput<typeof createBeadRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<CreateBeadResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) {
    return { issue: null, error: "Project not found." };
  }

  try {
    const issue = await createIssue(projectRootPath, patch);
    return { issue, error: null };
  } catch (error) {
    const message = error instanceof BeadsUnavailableError ? error.message : "Failed to create bead.";
    return { issue: null, error: message };
  }
}

export async function getBead(
  { projectId, id }: ZodOutput<typeof getBeadRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<GetBeadResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) {
    return { issue: null, error: "Project not found." };
  }

  try {
    const issue = await getIssue(projectRootPath, id);
    return { issue, error: null };
  } catch (error) {
    const message = error instanceof BeadsUnavailableError ? error.message : "Failed to load bead.";
    return { issue: null, error: message };
  }
}

export async function deleteBead(
  { projectId, id }: ZodOutput<typeof deleteBeadRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<DeleteBeadResult> {
  const projectRootPath = await resolveProjectRoot(paseo, projectId);
  if (!projectRootPath) {
    return { deleted: false, error: "Project not found." };
  }

  try {
    await deleteIssue(projectRootPath, id);
    return { deleted: true, error: null };
  } catch (error) {
    const message = error instanceof BeadsUnavailableError ? error.message : "Failed to delete bead.";
    return { deleted: false, error: message };
  }
}
