# Projects

A project groups conversations, assets and findings for one engagement. A user creates one from the Projects page with a name and an optional description, and it appears in the project list.

## Sub-features

- `project-create`: the dialog saves a named project.
- `project-list`: the new project appears on the Projects page.
- `project-stored`: the server returns it from `GET /api/projects`.

## How to get to it (user POV)

- Navigation: `Projects`, then the `+ New project` button at the top of the page.
- When no project is selected (a fresh instance, or after the last project was deleted), the empty state has a `Create first project` button.
- Chat: the workspace select in the composer (`Default workspace`) has a `+ New project` option. It opens the same form and selects the new project for the conversation.
- Bot command `new project <name>` when `project.enabled` is on and the sender is bound. Not driven here (see `docs/en-US/robot.md`).

## Driving it with drive.mjs

Preconditions:

- Baseline.

- **Run.** `node .claude/skills/verify-cyberstrikeai/drive.mjs .claude/skills/verify-cyberstrikeai/journeys/projects.mjs`.
- **Open dialog.** It goes to `#/projects` and clicks the button `+ New project`. A dialog opens.
- **Fill.** It fills the fields with placeholders `e.g. Client A Web pentest` (name, `verify-<timestamp>`) and `Client/task notes, team collaboration…` (description). Screenshot `01-dialog-filled.png`.
- **Create.** It clicks `Create project`. The dialog closes, the name is visible in `#main-content`, and `writes` has `200 POST /api/projects`. Screenshot `02-project-listed.png`.
- **Stored.** It reads `GET /api/projects` and fails if no project has that name. `observed` holds the id.
- **Chat entry point.** `node .claude/skills/verify-cyberstrikeai/drive.mjs .claude/skills/verify-cyberstrikeai/journeys/projects-chat.mjs`. It goes to `#/chat`, opens the composer's workspace select (`.chat-composer-project`), picks the option `+ New project`, fills the name in the dialog `New project` and clicks `Create project`. The select then shows the name, `writes` has `200 POST /api/projects`, and `GET /api/projects` returns it. Screenshots `01-dialog-filled.png`, `02-composer-shows-project.png`.

## Gotchas

- `Create first project` is not driven by a shipped journey; it shows only while no project is selected.
- The bot entry point needs a bound chat platform and is not driven.
- Editing, archiving, deleting, and the project detail tabs are not mapped.
- Projects accumulate until cleanup. Do not assert on the number of projects.
