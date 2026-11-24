// Create a project through the UI and confirm the server stored it.
export default async ({ page, expect, shot, api, base }) => {
    const name = `verify-${Date.now()}`;
    await page.goto(`${base}/#/projects`);
    await page.getByRole('button', { name: '+ New project' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('e.g. Client A Web pentest').fill(name);
    await dialog.getByPlaceholder('Client/task notes, team collaboration…').fill('created by verify-cyberstrikeai');
    await shot('dialog-filled');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#main-content').getByText(name).first()).toBeVisible();
    await shot('project-listed');

    const body = await api('/api/projects');
    const stored = (body.projects ?? body.items ?? body).find(p => p.name === name);
    if (!stored) throw new Error(`project ${name} is on screen but not in GET /api/projects`);
    return { name, id: stored.id, description: stored.description };
};
