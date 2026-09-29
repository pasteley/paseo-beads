import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const BeadDependencySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  dependencyType: z.string(),
});

export type BeadDependency = z.output<typeof BeadDependencySchema>;

export const BeadIssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(), // open | in_progress | blocked | deferred | closed
  priority: z.number(), // 0 (highest) .. 4 (lowest)
  issueType: z.string(),
  assignee: z.string().nullable(),
  /** Direct parent issue id (the `parent-child` dependency), or null for a top-level
   * issue. Drives the epic-nested tree view. */
  parent: z.string().nullable(),
  dependencyCount: z.number(),
  dependentCount: z.number(),
  commentCount: z.number(),
  dependencies: z.array(BeadDependencySchema),
  dependents: z.array(BeadDependencySchema),
  externalRef: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
});

export type BeadIssue = z.output<typeof BeadIssueSchema>;

/** The bd release this plugin targets. Below it there is no events journal and no
 * compare-and-set guards, and the panel falls back to polling. Stated here once; everything
 * else refers to this constant. */
export const MIN_BD_VERSION = "1.3.0";

/** `live`: the server follows the events journal and answers from a cache it keeps in step.
 * `poll`: no journal available, so each read is a short-lived list snapshot. */
export const BeadsFeedModeSchema = z.enum(["live", "poll"]);
export type BeadsFeedMode = z.output<typeof BeadsFeedModeSchema>;

/** `cli` forks `bd` per call; `http` talks to a `bd serve` named by `BD_SERVE_URL`. */
export const BeadsTransportSchema = z.enum(["cli", "http"]);
export type BeadsTransport = z.output<typeof BeadsTransportSchema>;

export const listBeadsRpc = defineRpc({
  name: "beads.list",
  input: z.object({
    projectId: z.string(),
    /** The `revision` of the snapshot the caller already holds. When it still matches, the
     * response is `unchanged: true` with no issues instead of the whole list again. */
    sinceRevision: z.number().optional(),
  }),
  output: z.object({
    available: z.boolean(),
    issues: z.array(BeadIssueSchema),
    error: z.string().nullable(),
    /** Monotonic per project root; only moves when the issue set actually changes. */
    revision: z.number(),
    unchanged: z.boolean(),
    mode: BeadsFeedModeSchema,
    transport: BeadsTransportSchema,
    /** The `bd` build backing this project, or null when it couldn't be determined. */
    bdVersion: z.string().nullable(),
    /** bd is new enough for the journal — see `MIN_BD_VERSION`. */
    supportsEvents: z.boolean(),
    /** `events-journal` is on for this workspace. */
    journalEnabled: z.boolean(),
    /** A configured `bd serve` that did not answer; the CLI is being used instead. */
    transportError: z.string().nullable(),
  }),
});
export type ListBeadsResult = z.output<typeof listBeadsRpc.output>;

/** Turns the journal on for the workspace. Only ever runs from an explicit user action: it is a
 * config write every later `bd` command in that checkout inherits, agents included. */
export const enableBeadEventsRpc = defineRpc({
  name: "beads.events.enable",
  input: z.object({ projectId: z.string() }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().nullable(),
  }),
});
export type EnableBeadEventsResult = z.output<typeof enableBeadEventsRpc.output>;

export const updateBeadRpc = defineRpc({
  name: "beads.update",
  input: z.object({
    projectId: z.string(),
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.number().min(0).max(4).optional(),
    status: z.string().optional(),
    issueType: z.string().optional(),
    externalRef: z.string().optional(),
    /** The status the panel rendered. The write is refused if the bead has moved since, instead
     * of overwriting whoever moved it. */
    ifStatus: z.string().optional(),
  }),
  output: z.object({
    issue: BeadIssueSchema.nullable(),
    error: z.string().nullable(),
    /** The compare-and-set guard was refused — reload rather than retry. */
    conflict: z.boolean(),
  }),
});

export type UpdateBeadResult = z.output<typeof updateBeadRpc.output>;

export const BeadStatusSchema = z.object({
  name: z.string(),
  icon: z.string(),
  category: z.string(),
});
export type BeadStatus = z.output<typeof BeadStatusSchema>;

/** The type/status vocabularies `bd` recognizes for this project — built-ins plus anything
 * added via `bd config set types.custom` / `status.custom`. Fetched once (rarely changes)
 * so the create/edit forms offer exactly what the CLI would accept. */
export const beadsMetaRpc = defineRpc({
  name: "beads.meta",
  input: z.object({ projectId: z.string() }),
  output: z.object({
    types: z.array(z.string()),
    statuses: z.array(BeadStatusSchema),
    error: z.string().nullable(),
  }),
});

export type BeadsMetaResult = z.output<typeof beadsMetaRpc.output>;

export const createBeadRpc = defineRpc({
  name: "beads.create",
  input: z.object({
    projectId: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.number().min(0).max(4).optional(),
    issueType: z.string().optional(),
  }),
  output: z.object({
    issue: BeadIssueSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type CreateBeadResult = z.output<typeof createBeadRpc.output>;

export const initBeadsRpc = defineRpc({
  name: "beads.init",
  input: z.object({ projectId: z.string() }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().nullable(),
  }),
});

export type InitBeadsResult = z.output<typeof initBeadsRpc.output>;

export const getBeadRpc = defineRpc({
  name: "beads.get",
  input: z.object({ projectId: z.string(), id: z.string() }),
  output: z.object({
    issue: BeadIssueSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type GetBeadResult = z.output<typeof getBeadRpc.output>;

export const deleteBeadRpc = defineRpc({
  name: "beads.delete",
  input: z.object({ projectId: z.string(), id: z.string() }),
  output: z.object({
    deleted: z.boolean(),
    error: z.string().nullable(),
  }),
});

export type DeleteBeadResult = z.output<typeof deleteBeadRpc.output>;
