# Connector enhancements plan (2026-11-17)

This plan follows Vesper's own stages: Vision, Research, then Plan. Execute and Review happen in the pull request.

## Vision

**Why.** A live test of the Claude connector showed that Claude cannot fix a Project whose current stage disagrees with its Selahs. Status and priority were also being kept as prefixes in titles ("Done · ", "Discuss · ", "Recurring · ", "P1 · "). The connector had no way to answer "what is on today?", no search, no bulk edits, and no record of what Claude changed.

**Goal.** Claude can keep a person's Vesper notebook tidy and answer planning questions using only connector tools. Titles hold names only. Status, priority and due dates live in fields. Every connector change can be traced, and the most recent one can be undone.

**Check.**
- Each new tool has a worker test.
- `npm run check` passes.
- Existing tools and parameters keep working (backward compatible).
- The live site and connector still answer after deploy.

**Limits.**
- No change to how a person passes a Selah in the app.
- The connector never deletes data without confirmation.
- No migration runs on live data without the person asking for it (the default is dry-run).
- There are no new required fields in stored data.

## Research

- **Stage and slide.** `deck.slide` is the slide index. The current stage comes from `slideFor(deck)`. `taskCheck` already reports two mismatches: "Selahs passed beyond current stage" and "Current slide is at or before passed Selahs". `vesper_loop_back` is the only tool that moves the slide, and it also clears Selahs.
- **Status.** `finished` (a timestamp) and `parked` (a boolean) already exist on Projects, and `done` exists on simple Tasks. "Discuss" and "Recurring" only exist as title prefixes. The dashboard falls back to a `P1 · ` title prefix for priority.
- **Sync.** `merge.js` merges every top-level record field with its own clock. A new optional field (`status`) therefore syncs without any schema change, and older clients keep it.
- **Hub storage.** `VAULT_KEYS` decides which keys move into a person's Drive vault. An audit log contains note text, so it must be one of those keys, just like `gevents`.
- **Overview.** `vesper_overview` rows already have a `status` field meaning progress (`active` / `finished` / `not started`). The new work status therefore needs a different name to stay backward compatible: `workStatus`.

## Plan

### Data-model changes (all optional, no backfill)

| Field | On | Values | Notes |
|-------|----|--------|-------|
| `status` | Project, simple Task | `discuss`, `recurring` | Absent means none. Synced with per-field clocks. |
| `notes["<stage>.selah#pass<N>"]` | Project | text | Archived Selah answers. Added in PR #1. The app's Review-slide loop back now does the same. |

**Derived `workStatus`** (never stored):
1. `finished` if the item is finished or done.
2. Otherwise `parked` if `parked` is true.
3. Otherwise `discuss` or `recurring` if `status` is set.
4. Otherwise `active`.

**Audit log** (hub key `audit`, stored in the vault like `gevents`): the last 30 connector changes. Each entry has the time, tool, arguments (capped), change texts, and a copy of every changed record taken before the change. These copies make undo possible.

### Tools

New tools:

| Tool | Input | Output / rule |
|------|-------|---------------|
| `vesper_set_stage` | `project`, `stage?` (vision…review or recap), `slide?` (slide key), `force?`, `reason?` | Moves the current slide without passing or clearing any Selah. With no stage or slide, it moves to the first stage whose Selah is open. It refuses to go past an open Selah, or onto a stage whose Selah is passed, unless `force: true` and a reason (1–240 characters) are given. |
| `vesper_set_status` | `project` or `task`, `status` (active / parked / discuss / recurring / finished) | `finished` on a Project is refused: use `vesper_finish`, which keeps the Selah rules. `finished` on a simple Task sets `done`. |
| `vesper_migrate_title_prefixes` | `apply?` (default false) | Dry-run by default. Strips leading `Done`, `Discuss`, `Recurring`, `Parked` and `P1`–`P4` prefixes (with `·`, `:` or `-`) and turns each into a field. A "Done" Project with open Selahs is not finished; it is listed under `notApplied` instead. |
| `vesper_summary` | `area?` | Counts by kind, stage, priority and workStatus, plus overdue and due-soon counts. |
| `vesper_agenda` | `days?` (default 7), `limit?` | Lists overdue items, items due within `days`, open P1 items, and the next step of each active Project with its current stage. |
| `vesper_bulk` | `ids[]`, `set?` {priority, due, status}, `move?` {inbox / area / project}, `dryRun?` (default true) | Gives `changed` / `notApplied` for each id. A dry run works on a copy and saves nothing. |
| `vesper_search` | `query`, `area?`, `limit?` | Full-text search across titles, step notes, slide notes, archived Selah answers and Task notes. Returns snippets. |
| `vesper_history` | `limit?` | Recent connector changes, newest first. |
| `vesper_undo` | `confirm` | Restores the records touched by the most recent logged change, then removes that entry. It refuses entries that deleted something. |

Upgrades to existing tools (all backward compatible):
- **`vesper_pass_selah`:** gives `warnings` listing the stage's steps that are empty and unticked. The default is to warn. `strict: true` refuses instead.
- **Project summaries** (`get_project`, `next_questions`, etc.): add `stepsTicked`, `stepsAnswered` (a note or a tick) and `workStatus`. `stepsFilled` keeps its meaning (notes).
- **`vesper_overview`:**
  - New filters: `overdue`, `dueSoon` (days), `workStatus`.
  - New `sort` option: order / priority / due / updated.
  - Every line also carries `priority`, `due`, `parked`, `workStatus` and `updated` (ISO).
- **Tool descriptions:** say that titles hold names only, and that priority, status and due go in their fields.

### Tests
- One worker test per new tool and per upgrade, in `tests/worker.test.js` style.
- A logic test for the shared helpers (workStatus, title prefix parsing, Selah archive).

### Rollout
1. Branch `feat/mcp-enhancements-2026-11-17`, built on PR #1.
2. Small commits, with `node worker/build.js` and the service-worker stamp regenerated.
3. `npm run check` and `npm test` pass, then a PR to `main` and green CI.
4. Merge. Main auto-deploys to Hostinger.
5. Reconnect the connector in Claude so the new tool list loads.
6. Optional: run `vesper_migrate_title_prefixes` as a dry run, review it, then run it again with `apply: true`.

### Rollback
- Revert the merge commit on `main`. Hostinger redeploys the previous code.
- Stored data stays readable. `status` and the audit key are optional, and older code ignores them.
- If a migration was applied, `vesper_undo` reverses it while it is still the latest logged change. The daily snapshots (`backup:YYYY-MM-DD`) cover anything older.

### Later (not in this change)
- Show `status` (discuss / recurring) as a chip in the app and add a filter on the dashboard. Until then, a migrated "Discuss · " title loses its visible prefix in the app.
- Undo for deletions and multi-step undo.
- Log edits made in the app (not only connector edits) to the audit log.
- Archive Selah answers when "Take this Selah back" is used in the app.
