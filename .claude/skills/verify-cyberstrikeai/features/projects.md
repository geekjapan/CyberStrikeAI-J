# Projects

A project groups conversations, assets and findings for one engagement. A user creates one from the Projects page with a name and an optional description, and it appears in the project list.

## Sub-features

- `project-create`: the dialog saves a named project.
- `project-list`: the new project appears on the Projects page.
- `project-stored`: the server returns it from `GET /api/projects`.

## How to get to it (user POV)

- Navigation: `Projects`, then the `+ New project` button at the top of the page.
- On an instance with no projects, the empty state also has a `Create first project` button.

## Driving it with drive.mjs

Preconditions:

- Baseline.

- **Run.** `node .claude/skills/verify-cyberstrikeai/drive.mjs .claude/skills/verify-cyberstrikeai/journeys/projects.mjs`.
- **Open dialog.** It goes to `#/projects` and clicks the button `+ New project`. A dialog opens.
- **Fill.** It fills the fields with placeholders `e.g. Client A Web pentest` (name, `verify-<timestamp>`) and `Client/task notes, team collaboration…` (description). Screenshot `01-dialog-filled.png`.
- **Create.** It clicks `Create project`. The dialog closes, the name is visible in `#main-content`, and `writes` has `200 POST /api/projects`. Screenshot `02-project-listed.png`.
- **Stored.** It reads `GET /api/projects` and fails if no project has that name. `observed` holds the id.

## Gotchas

- The journey uses `+ New project` only. `Create first project` exists only while the list is empty, so it is reachable only as the first project of a fresh instance; it is not driven by the shipped journey.
- Editing, archiving, deleting, and the project detail tabs are not mapped.
- Projects accumulate until cleanup. Do not assert on the number of projects.
