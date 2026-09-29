# Changelog

## 0.0.3

### Added
- **Live updates** — the server follows bd's events journal instead of re-running `bd list` on a
  timer, so a change made by an agent or in a terminal shows up in about a second. Needs bd ≥
  1.3.0 with `events-journal` on; the footer says **Live**, or offers the button that turns it on
- **Guarded edits**: saving over a bead someone else moved since you opened it is refused and
  reloaded instead of overwriting it
- Optional `bd serve` transport (`BD_SERVE_URL`, `BD_SERVE_TOKEN`): reads, writes and the journal
  go over loopback HTTP with no `bd` process per call. Needs a Dolt server-mode workspace; falls
  back to the CLI with a notice

### Changed
- Opening a bead no longer waits on `bd show` — one list read carries its text and both
  dependency directions, the reverse one indexed on the server
- Far fewer `bd` processes: reads are served from the cache, `beads.list` answers `unchanged` when
  nothing moved, and the database probe, version check and type/status vocabularies are no longer
  re-run per read
- Targets bd ≥ 1.3.0; older versions keep working on the previous 5s polling and the panel says so
- List limit raised from 200 to 1000 issues

## 0.0.2

### Changed
- Migrated to the Paseo v0.8 plugin runtime entries: `index.ts` split into `index.client.tsx`
  and `index.server.ts`, modules moved under `client/`, `server/` and `shared/`, SDK types
  now come from `@getpaseo/plugin` instead of a vendored `paseo-plugin.d.ts`
- Requires Paseo ≥ 0.8.0 (`requirements.paseo` in `paseo-plugin.json`)

## 0.0.1

### Added
- **Group** toggle: epic-nested tree view mirroring `bd list`, with collapsible branches
- Search field now also filters — `type:bug`, `status:open`, `priority:1`, `assignee:me`,
  `parent:bd-3` (a space after the colon is fine), plus `p0`–`p4` shorthand, with active
  filters shown as removable chips
- Sort by the issue-type column
- **New bead** form: pick the issue type
- Edit a bead's type from the detail panel
- **Run bd init** button in projects without a bd database (runs `bd init --non-interactive`)
- Type and status option lists are read from `bd types` / `bd statuses`, so custom vocab
  configured in bd shows up in the pickers
- Responsive table: columns drop as the panel narrows (`updated` then `priority` then `id`),
  and status shrinks to its `bd` glyph rather than disappearing
- Skeleton rows on first load instead of a bare spinner
- Long descriptions collapse behind a "Show full description" toggle, and the edit box
  auto-grows to fit its content

### Changed
- IDs sort naturally (`bd-2` before `bd-10`)
- Dependency links render as a bulleted list (capped with "show more") instead of
  wrapping pills
- Status shown with a colour dot and friendly label ("In progress"), priority P0/P1 coloured
- Removed the redundant "Beads" panel title, issue count moved to a footer
  (`N of M issues` when filtered)
- Epic rows get a subtle background tint
- Search input is debounced
- Split `beads.client.tsx` into `beads.view.ts` (pure logic) and `beads.theme.ts`
  (tokens and styles)

### Fixed
- Grouped view now keeps the data columns grid-aligned regardless of nesting depth
- Selecting a row no longer nudges its content sideways
- Collapse/expand chevron no longer makes the row twitch
