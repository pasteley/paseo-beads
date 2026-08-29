# paseo-beads

> [!WARNING]
> Experimental and naive, not production-ready

![Beads workspace panel](screenshot.png)

A [Paseo](https://github.com/getpaseo/paseo) plugin that wraps [`bd`](https://github.com/gastownhall/beads), the hierarchical,
dependency-aware issue tracker built for agent workflows, into a workspace panel. Paseo has
no built-in task tracker (yet?). But `bd` already does hierarchical IDs, a blocking-dependency graph,
priorities, and it auto-installs agent guidance, so this just brings that into the app instead of a terminal.

It's a thin UI over the real CLI, not a reimplementation: every action shells out to `bd`.

## What it does

- A **Beads** tab in the workspace bar shows a sortable, searchable table of the project's
  issues.
- Each row opens an inline detail panel: title, status, priority, and a markdown
  description are editable, and a bead can be deleted with a confirm.
- Dependency links ("depends on" / "required by") connect related beads for quick
  navigation between them.
- On an open, unblocked bead, **Create workspace** spins up a worktree and links it back to
  the bead (`external-ref`), so the panel remembers which workspace picked it up.

## Setup

Install `bd`: https://github.com/gastownhall/beads#-quick-start

Initialize it in your project's root checkout (not a worktree):

```bash
cd /path/to/your/project
bd init
```

Install the plugin and turn on **Enable plugins** under Settings → Plugins:

```bash
paseo plugin add pasteley/paseo-beads
```

## Known problems/limitations

- **Slow.** Every action shells out to a fresh `bd` process, roughly 300ms per click, since
  `bd init` defaults to an embedded engine rather than the sql-server mode.
- **No live updates.** List and detail poll every 5s, no push/watch.
- **No "open workspace" link** on any released Paseo build yet, so no navigation API availible.
- **No reverse link.** A bead knows its workspace, but a workspace doesn't show its bead.
- **Hand-rolled markdown**, not Paseo's real renderer. A small subset of CommonMark.
- **No claim/assignee, comments, bulk actions, or issue tracker correlation.** Use the `bd`
  CLI directly for those.

## Requirements

- Node ≥ 22 (for `Promise.withResolvers`)
- `bd` on `PATH` (or set `BD_BINARY` to an absolute path)
