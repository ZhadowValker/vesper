# Batch 6: Areas, Projects and simple Tasks

## Scope and release sequence

Only `vesper-fixes` is changed. The application remains dependency-free vanilla
HTML/CSS/ES-module JavaScript; Node and Worker share the same model and merge code.
Each stage is committed with freshly generated Worker/cache files and passing
`npm run check`. No main changes, force pushes, merges or pull requests.

1. This plan (`docs: batch 6 plan`).
2. Data, migration, hub backups and compatibility (`model: areas projects and tasks`).
3. Screens and simple-task operations (`app: areas projects and simple tasks`).
4. Connector, AI, interview and export (`connector: areas projects and tasks`).
5. Documentation and final Node 20/22 verification (`docs: version 2 upgrade guide`).
6. Push the completed branch using the existing secret through a process-local
   credential helper, never persisting or printing its value.

## Version 2 data

```
{
  version: 2,
  areas: [{ id, name, order, created, updated, _changed }],
  projects: [{
    id, areaId, title, priority?, due?, order,
    slide, reached, notes, ticks, selah, selahBy?,
    passes, loops, finished, finishedEarly?, timer,
    promotedFrom?, created, updated, _changed
  }],
  tasks: [{
    id, title, done, priority?, due?, note, order,
    location: { kind: "inbox" }
            | { kind: "area", id: areaId }
            | { kind: "project", id: projectId },
    promotedTo?, created, updated, _changed
  }],
  deleted: { recordId: timestamp }
}
```

Names/order are the only editable Area properties. Identity, clocks and creation
metadata remain necessary for safe synchronization. Projects never nest.
Location is a single independently timestamped field, not separately mergeable
area/project pointers: concurrent moves cannot create an invalid double location.
Date values remain calendar dates; missing priority/date mean no value.

Internal legacy store-method and route aliases may remain during the staged
implementation so that intermediate commits still run; exported/persisted data is
version 2 and user-facing terminology is Area / Project / Task.

## Lossless migration and old clients

* Preserve all IDs. Map v1 `projects` to `areas`, and v1 `decks` to `projects`,
  renaming their parent reference to `areaId`. No simple tasks are synthesized.
* Preserve every other flow field, unknown extension field, item clock, deletion
  timestamp, note/tick/Selah, order, priority/date and finish record.
* Quick projects become Full. Keep their `*.quick` notes, shown read-only only on
  the first Full slide of that stage. Quick mode cannot be created or selected.
* Migration is idempotent. Version 1 JSON imports continue to work. Unsupported
  future versions and malformed backups fail explicitly rather than being erased.
* Before browser persistence migration, retain the raw v1 document in a separate
  local backup key; do not replace the original if backing it up fails.
* Before hub migration, retain the exact v1 document in a dedicated pre-v2 snapshot
  (outside the public file allowlist; KV for Worker). Migration happens under the
  existing serialized/merge-save protection. Daily backups remain independent.
* Normalize every old-client upload before merging. An absent v2 tasks collection
  in an old payload never means delete. Do not re-enable Quick or let old field
  timestamps undo the normalized Full mode/parent representation.
* Where needed, old sync clients receive a v1 projection (Areas as projects,
  Projects as decks). New clients identify model version 2. A projection contains
  no simple tasks, but the canonical hub never discards them on round-trip.

## Merge and integrity rules

All three collections merge by ID with per-field clocks and deterministic ties.
Projects retain the existing separate clocks for individual step notes, ticks,
Selah answers/passes and flow fields. Task title, done, note, priority, due, order,
promotion reference and location merge independently. Area name/order do too.
The existing deletion timestamp rule remains: deletions beat older edits.
Invalid parent references never become nested projects. Preserve simple-task
content when a parent disappears by relocating it to Inbox; never silently erase
the task. Area/project deletion dialogs must explain affected content.

Promotion creates a deterministic Project identity tied to the task, avoiding
duplicate Projects when two devices promote the same task offline. The task
retains `promotedTo` and disappears from task lists; the Project retains
`promotedFrom`. Its first Vision/Why step receives the note. Done tasks cannot
be promoted. Inbox promotion requires an Area. A task inside a Project promotes
beside its parent in that parent's Area.

Demotion requires genuinely empty flow data, including retained Quick notes.
It keeps title/priority/due in an Area task. Any contained simple tasks are moved
to that Area rather than lost. Reverse identity references retain provenance.

## Screens and navigation

* **Home:** current Project resume, mixed priority/date sorting and priority
  filtering, Inbox tasks and Areas; settings, sync, backup and appearance remain.
* **New:** Task or Project. Task title alone defaults to Inbox; optional location.
  Project title plus required Area. Area creation remains available.
* **Area:** rename/reorder Area, Projects with multistage bars, loose tasks,
  add/rename/reorder controls and mixed sort/filter controls.
* **Project:** unchanged Full flow/mind map/player plus its task list and Add task;
  metadata, rename, Area move, export, calendar and empty-flow demotion.
* **Task:** done checkbox, title, priority/date chips, editable short note,
  metadata, move (Inbox/Area/Project), delete and promotion for open tasks.
* **Finish:** existing missing-Selah confirmation, plus open-task count even when
  all Selahs passed. Open tasks do not block Finish. Connector normal Selah
  force/reason checks remain; responses mention outstanding tasks.
* **Player:** always the 27-slide flow; old Quick notes appear read-only on the
  first slide of the relevant stage. No Quick controls, creation or interview.
* **Guide/sample:** new terminology. Book example has an Area, its Vesper
  Projects and simple tasks in Inbox, Area and Project.
* Both themes and offline caching include all added UI/modules.

## Connector and AI contract

New canonical tools:

* `vesper_create_area(name)`
* `vesper_create_project(area, title, priority?, due?)`
* `vesper_create_task(title, area? | project?, priority?, due?, note?)` (simple)
* `vesper_update_task(task, title?, done?, priority?, due?, note?)`
* `vesper_move_task(task, inbox? | area? | project?)`
* `vesper_promote_task(task, area?)`
* `vesper_demote_project(project)`
* `vesper_list_areas`

Keep framework/overview and all existing flow capabilities: get, next_questions,
set_note, tick, pass_selah, loop_back, finish, schedule, rename, reorder, delete
and priority/due editing. Flow tools accept canonical `project` and deprecated
`task` as an alias for that Project. Expose a clear `vesper_get_project` and
`vesper_set_project` where the old name would otherwise be ambiguous.
`vesper_list_projects` deliberately remains an alias of `vesper_list_areas`,
with a deprecation note. Legacy `vesper_get_task`/`vesper_set_task` remain flow
aliases; simple Tasks use update/get through the new contract.

Overview outputs one row per Project or simple Task with kind, Area/location,
priority/date, status and applicable flow/check details. Retain existing filters
and add kind and Area. Framework explains the model and compatibility aliases.
AI action validation mirrors tools, including promotion/demotion and moves.
Interview only selects/creates Projects, never simple Tasks.
Area Markdown includes Projects and simple Tasks; Project Markdown includes its
simple Tasks. Hidden promoted tasks are not duplicated in lists/exports.

## Verification

* Migrate bundled and handcrafted v1 states with exact IDs, counts, fields and
  clocks; repeated migration and v1 import; no synthesized simple tasks.
* Backup-before-migration ordering/failure behavior in Node/KV, old-client sync
  against v2 state, preservation of new simple Tasks on old uploads.
* Per-field concurrent task done/note and location/title merges; tombstones.
* Creation, all move locations, promotion (including concurrent promotion),
  demotion refusal/data preservation, open-task Finish warnings.
* Mixed sorting/filtering and Home/Area/Project/task rendering.
* Every new tool, old argument aliases, mixed overview and AI actions.
* Full existing regression suite, real cached-asset MIME/byte checks, generated
  Worker and deterministic SW stamp; final `npm run check` on Node 20 and 22.
* Browser smoke checks in both themes with isolated synthetic data; never use
  live hub data for tests.

## Upgrade risks and operational notes

Back up before upgrading a live hub. Deploy server/Worker and reload every device
together where possible. Old clients cannot display simple Tasks; compatibility
projection is transitional, not an invitation to keep old clients indefinitely.
Pre-v2 snapshots must be retained separately from 14-day daily rotation.
Storage quota/KV failures must abort migration safely, not discard the old state.
Record IDs and tombstones must remain stable to avoid resurrection/duplication.
Promotion/demotion across offline devices need deterministic identity and clocks.
Do not roll only application files back against a v2 store: restore a compatible
backup/client/server set if rollback is necessary.
