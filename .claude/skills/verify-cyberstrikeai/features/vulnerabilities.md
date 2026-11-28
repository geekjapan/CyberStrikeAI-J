# Vulnerabilities

The Vulnerabilities page is the record of findings. A user can add a finding by hand with a title, a severity and details, and it appears in the table and in the severity counters.

## Sub-features

- `vuln-required`: `Title` and `Severity` are required; saving without them keeps the panel open with a field error.
- `vuln-create`: a filled form saves the finding.
- `vuln-list`: the finding appears in the table.
- `vuln-stored`: the server returns it from `GET /api/vulnerabilities` with the chosen severity and status `open`.

## How to get to it (user POV)

- Navigation: `Vulnerabilities`, then the `Add vulnerability` button. A side panel opens.
- The agent can also record findings during a chat run. That path needs a model and is not driven here.

## Driving it with drive.mjs

Preconditions:

- Baseline.

- **Run.** `node .claude/skills/verify-cyberstrikeai/drive.mjs .claude/skills/verify-cyberstrikeai/journeys/vulnerabilities.mjs`.
- **Open panel.** It goes to `#/vulnerabilities` and clicks `Add vulnerability`. A dialog named `Add vulnerability` opens.
- **Fill.** Title by placeholder `api/login is vulnerable to SQL injection`; severity by opening the combobox in the `Severity` field and clicking the option `High`; target, type and description by their placeholders. Screenshot `01-dialog-filled.png`.
- **Save.** It clicks `Save`. The panel closes, the title is visible in the table, and `writes` has `200 POST /api/vulnerabilities`. Screenshot `02-finding-listed.png`.
- **Stored.** It reads `GET /api/vulnerabilities` and fails if the title is missing. `observed` holds id, severity (`high`) and status (`open`).

## Gotchas

- `vuln-required` is not asserted by the journey. It was seen once by hand: saving without a severity keeps the panel open and shows a field error (`Select a severity` in English).
- The severity control is a Semi Design select, not a native `<select>`. Click its combobox first; the options then have `role="option"`, so `getByRole('option', { name: 'High' })` and `.semi-select-option` both find them.
- The open severity dropdown also has `role="dialog"`. A bare `getByRole('dialog')` then matches two elements and fails intermittently; always name the panel: `getByRole('dialog', { name: 'Add vulnerability' })`.
- The target the journey enters (`http://127.0.0.1:1/none`) is a label only. Nothing connects to it.
- Editing, status changes, export and batch delete are not mapped.
