# Semi Design Workbench

CyberStrikeAI opens the React + Semi Design workbench from `/` by default. The dashboard, projects, assets, vulnerabilities, files, MCP monitoring,
knowledge, skills, roles and agent views, platform permissions, system settings and API docs share the existing login session and permissions.

The legacy `/classic` entry redirects to the workbench, and the browser keeps the page fragment from bookmarks. `/api-docs` redirects to `/#/api-docs`.
The agent and role pages are view-only. The settings page provides the existing settings sections of the Semi workbench, and the API docs page is for browsing API definitions.

## Development and verification

Use Node.js 22. Vite starts React and Semi Design from `src/main.jsx`. Pages are registered in
`src/pages/registry.js`, call same-origin APIs through `src/lib/http.js`, and reuse the strings in `web/static/i18n/`.

```sh
npm ci --prefix web/frontend
npm run --prefix web/frontend dev
npm run --prefix web/frontend build
node --test web/frontend/tests/*.test.mjs
npm run --prefix web/frontend test:ui
```

The Vite dev address is `http://localhost:5199/static/app/`. For integration work, set
`CSAI_API_ORIGIN=http://127.0.0.1:8080` for the dev command. Browser regression tests use anonymous data and mocked APIs, covering login, navigation,
permissions, graphs, forms, settings and mobile layout.

Build output is written to `web/static/app/` and committed with the source. The server serves JS and CSS from the existing static asset path,
and the root path returns the built HTML.
