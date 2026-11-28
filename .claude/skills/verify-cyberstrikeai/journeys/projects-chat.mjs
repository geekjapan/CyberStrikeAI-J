// Create a project from the chat composer's workspace select and confirm the server stored it.
export default async ({ page, expect, shot, api, base }) => {
    const name = `verify-chat-${Date.now()}`;
    await page.goto(`${base}/#/chat`);
    await page.locator('.chat-composer-project').click();
    await page.getByRole('option', { name: '+ New project' }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByPlaceholder('e.g. Client A Web pentest').fill(name);
    await shot('dialog-filled');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page.locator('.chat-composer-project')).toContainText(name);
    await shot('composer-shows-project');
    const body = await api('/api/projects');
    const p = body.projects.find(x => x.name === name);
    if (!p) throw new Error('project missing from GET /api/projects');
    return { id: p.id, name };
};
