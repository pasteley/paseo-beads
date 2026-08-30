# Changelog

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
