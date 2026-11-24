# Skills Directory (Agent Skills / Pi)

- Each skill is a **subdirectory** with a required **`SKILL.md`** at its root (YAML front matter: `name`, `description`, plus a Markdown body). See [agentskills.io](https://agentskills.io/specification.md).
- **The directory name must match `name`.**
- **Runtime loading**: in **Pi single-agent or multi-agent** sessions, the native **`skill` tool** discloses skills progressively (the system prompt lists each skill's name/description, and the model then calls the **`skill`** tool to pull the full `SKILL.md`). You can optionally enable **`multi_agent.skills.filesystem_tools`** to access scripts and resources inside a package with the same `read_file` / `execute` tools used locally.
- **Web management**: the HTTP `/api/skills/*` endpoints still handle listing, editing, and uploading files inside a package (implemented in `internal/skillpackage`, not MCP).
- **Runtime**: both single-agent and multi-agent modes load skills on demand through the native **`skill`** tool.
