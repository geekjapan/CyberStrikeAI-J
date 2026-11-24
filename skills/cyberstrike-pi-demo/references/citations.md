# Citations and External Links (Example)

This file verifies that the **`references/`** directory in a skill package is correctly recognized by the list API, HTTP `resource_path`, and the multi-agent local file tools.

## How to Test (in an authorized environment)

1. The `package_files` field in the `GET /api/skills/cyberstrike-pi-demo` response should include `references/citations.md`.
2. `GET /api/skills/cyberstrike-pi-demo?resource_path=references/citations.md` should return the content of this file.
3. With multi-agent mode and `skills.filesystem_tools` enabled, this file can be read by relative path.

## Placeholder Citation

- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/) (link format example only)
