import { test, expect, ready, UI_PERMISSIONS } from './fixtures.mjs';

const auditURL = 'https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const mainModel = { provider: 'claude', base_url: 'https://main.example.test', model: 'main-model', api_key: '********' };

test.describe('audit model connection test', () => {
    test.use({ appPermissions: [...UI_PERMISSIONS, 'config:write'] });

    for (const entry of [
        { name: 'Qwen alongside a Claude main model', backend: 'openai', provider: 'openai_compatible', url: auditURL, model: 'qwen4-max', protocol: 'OpenAI-compatible API' },
        { name: 'TypeSafe Jev', backend: 'typesafe', url: '', model: '', protocol: 'TypeSafe / Jev' },
        { name: 'Jev backend alias', backend: ' Jev ', url: '', model: '', protocol: 'TypeSafe / Jev' },
        { name: 'default chat backend inherits the main model', url: '', model: '', protocol: 'Claude (Anthropic Messages)' }
    ]) {
        test(entry.name, async ({ page, mockApi }) => {
            mockApi.respond('GET', '/api/config', { json: {
                openai: mainModel, tools: [],
                hitl: { audit_backend: entry.backend, audit_model: {
                    provider: entry.provider, base_url: entry.url, model: entry.model, api_key: '********'
                } }
            } });
            mockApi.respond('POST', '/api/config/test-audit-model', { json: { success: true, model: entry.model || 'configured-model', latency_ms: 123 } });
            await page.goto('/static/app/#/settings?section=models');
            const main = await ready(page);
            await main.getByText('Audit model', { exact: true }).click();
            const card = main.locator('.settings-audit-model').locator('.settings-probe-card');
            await expect(card.getByText(entry.protocol, { exact: true })).toBeVisible();
            await expect(card.getByLabel('Base URL', { exact: true })).toHaveValue(entry.url);
            await expect(card.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'password');
            if (!entry.url) {
                await expect(card.getByLabel('Base URL', { exact: true })).toHaveAttribute('placeholder', entry.protocol === 'TypeSafe / Jev' ? 'https://api.typesafe.ai' : mainModel.base_url);
            }
            await card.getByRole('button', { name: 'Test audit model', exact: true }).click();
            await expect(card.getByText('Connection successful', { exact: true })).toBeVisible();
            expect(mockApi.writes().map(({ path, body }) => [path, body])).toEqual([
                ['/api/config/test-audit-model', { base_url: entry.url, api_key: '********', model: entry.model }]
            ]);

            // Form edits are transient test overrides and never save model settings.
            await card.getByLabel('Model', { exact: true }).fill('draft-model');
            await expect(card.getByText('Connection successful', { exact: true })).toHaveCount(0);
            mockApi.respond('POST', '/api/config/test-audit-model', { json: { success: false, error: 'API returned an error (HTTP 401): invalid credential', status_code: 401 } });
            await card.getByRole('button', { name: 'Test audit model', exact: true }).click();
            await expect(card.getByText('API returned an error (HTTP 401): invalid credential', { exact: true })).toBeVisible();
            expect(mockApi.writes()).toHaveLength(2);
            expect(mockApi.writes()[1]).toMatchObject({ path: '/api/config/test-audit-model', body: { model: 'draft-model' } });
        });
    }
});

test('audit model viewer cannot edit or start a test', async ({ page, mockApi }) => {
    mockApi.respond('GET', '/api/config', { json: { openai: mainModel, tools: [] } });
    await page.goto('/static/app/#/settings?section=models');
    const main = await ready(page);
    await main.getByText('Audit model', { exact: true }).click();
    const card = main.locator('.settings-audit-model').locator('.settings-probe-card');
    await expect(card.getByLabel('Base URL', { exact: true })).toHaveAttribute('readonly', '');
    await expect(card.getByRole('button', { name: 'Test audit model', exact: true })).toBeDisabled();
    expect(mockApi.writes()).toEqual([]);
});
