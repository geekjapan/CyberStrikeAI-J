# CyberStrikeAI verification map

The maintained list of user-facing features this skill can reach and prove. Read this index, then follow the matching feature file. Paths are relative to the repository root.

## Baseline preconditions

- The instance was started by `.claude/skills/verify-cyberstrikeai/launch.sh` in this session and `.claude/skills/verify-cyberstrikeai/doctor.sh` exits 0.
- The instance starts empty: one user (`admin`), no projects, findings or conversations. Journeys create what they need with unique names and do not depend on each other.
- Never drive a server this run did not start.

## Driving conventions

- Run journeys with `node .claude/skills/verify-cyberstrikeai/drive.mjs .claude/skills/verify-cyberstrikeai/journeys/<name>.mjs`. Exit 0 and a `PASS` line mean every assertion held.
- The UI language is `en-US` unless the journey changes it. Each run uses a fresh browser profile, so a language change does not leak into the next run.
- Server data does persist between runs until cleanup. Assert on the unique name the journey created, never on counts.
- Prefer roles, accessible names and placeholders over CSS classes.

## Proof and skip reporting

- Proof is the evidence folder the run prints: screenshots before and after the action, plus `result.json` with the API writes and the value read back from the server.
- A journey that fails because a precondition is missing (for example no model for chat) is reported as failed with that reason. It is not replaced by a weaker check.
- An entry point that was not driven is reported as not verified, even if another entry point of the same feature passed.

## Feature entry contract

Each feature file has an H1, one paragraph on the user-visible behaviour, then four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.mjs`, `Gotchas`.

## Features

- [Sign in](./login.md): wrong password rejected, right password opens the dashboard. Journey `login`.
- [Interface language](./language.md): switch among three languages, kept after reload. Journey `language`.
- [Projects](./projects.md): create a project and see it listed. Journey `projects`.
- [Vulnerabilities](./vulnerabilities.md): record a finding by hand. Journey `vulnerabilities`.
- [Chat](./chat.md): send a message to the agent and get a reply. Journey `chat`, needs a model.

## Not mapped yet

Tasks, workflows, WebShell management, C2, file management, MCP, knowledge, skills, agents, roles, platform access, system settings, API docs. Add a feature file and a journey when a change touches one of them.
