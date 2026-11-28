// Record a finding by hand and confirm the server stored it.
export default async ({ page, expect, shot, api, base }) => {
    const title = `verify finding ${Date.now()}`;
    await page.goto(`${base}/#/vulnerabilities`);
    await page.getByRole('button', { name: 'Add vulnerability' }).click();
    // Name the panel: the severity dropdown is a second role=dialog element.
    const dialog = page.getByRole('dialog', { name: 'Add vulnerability' });
    await dialog.getByPlaceholder('api/login is vulnerable to SQL injection').fill(title);
    // Severity is required and is a Semi select, not a native <select>.
    await dialog.locator('.semi-form-field', { hasText: 'Severity' }).getByRole('combobox').click();
    await page.locator('.semi-select-option', { hasText: /^High$/ }).click();
    await dialog.getByPlaceholder('Be specific: URL, IP:port, endpoint path, and parameter name.').fill('http://127.0.0.1:1/none');
    await dialog.getByPlaceholder('e.g. SQL injection, XSS, CSRF').fill('verification-sample');
    await dialog.getByPlaceholder('Describe the summary, trigger point', { exact: false }).fill('created by verify-cyberstrikeai');
    await shot('dialog-filled');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#main-content').getByText(title).first()).toBeVisible();
    await shot('finding-listed');

    const body = await api('/api/vulnerabilities');
    const stored = (body.vulnerabilities ?? body.items ?? body).find(v => v.title === title);
    if (!stored) throw new Error(`finding "${title}" is on screen but not in GET /api/vulnerabilities`);
    return { title, id: stored.id, severity: stored.severity, status: stored.status };
};
