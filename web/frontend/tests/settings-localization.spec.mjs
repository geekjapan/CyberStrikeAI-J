import { test, expect, ready, label, UI_PERMISSIONS } from './fixtures.mjs';

const currentRepo = 'https://example.test/team/current.git';
const newRepo = 'https://example.test/team/mirror.git';
const defaultRepo = 'https://example.test/default/project.git';

function mockUpdateStatus(mockApi) {
    mockApi.respond('GET', '/api/system/update', { json: {
        status: { installed: true, buildPending: false, localChanges: [], blockingChanges: [] },
        source: { repo: currentRepo, configured: true, defaultRepo }
    } });
}

test.describe('model probe localization', () => {
    test.use({ appPermissions: [...UI_PERMISSIONS, 'config:write'] });

    test('English field names and probe diagnostics keep their meaning when the language changes to Japanese', async ({ page, mockApi }) => {
        mockApi.respond('GET', '/api/config', { json: {
            ai: { default_channel: 'fixture-channel', channels: {
                'fixture-channel': {
                    provider: 'openai_compatible', base_url: 'https://example.test/models',
                    model: 'fixture-model', api_key: '********', max_total_tokens: 100000
                }
            } },
            tools: []
        } });
        mockApi.respond('POST', '/api/config/test-openai', { json: {
            success: true, model: 'fixture-model', latency_ms: 961,
            context_backend: 'openai_compatible', context_warnings: ['context_window_unknown']
        } });
        await page.goto('/static/app/#/settings?section=models');
        const main = await ready(page);
        const probe = main.locator('.cs-section-card').filter({ has: page.locator('.settings-probe-form') });
        await expect(probe.getByLabel('Base URL', { exact: true }).first()).toHaveValue('https://example.test/models');
        await expect(probe.getByText('Max Output Tokens', { exact: true })).toBeVisible();
        await probe.getByRole('button', { name: 'Test connection', exact: true }).click();
        await expect(probe.getByRole('cell', { name: /Response latency.*961 ms/ })).toBeVisible();
        await expect(probe.getByText('Connection successful', { exact: true })).toBeVisible();
        await expect(probe.getByText('961 ms', { exact: true })).toBeVisible();
        await expect(probe.getByText('No context window detected; enter it manually', { exact: true })).toBeVisible();
        await expect(probe.getByText(/context_warnings|context_window_unknown|latency_ms/)).toHaveCount(0);
        expect(mockApi.calls('POST', '/api/config/test-openai')[0].body).toMatchObject({
            provider: 'openai_compatible', base_url: 'https://example.test/models',
            model: 'fixture-model', api_key: '********', max_total_tokens: 100000
        });

        // The switcher button shows the current language code; expected text comes from the real dictionaries.
        let current = 'en-US';
        for (const [lang, name] of [['ja-JP', '日本語']]) {
            await page.getByRole('button', { name: current, exact: true }).click();
            await page.getByText(name, { exact: true }).click();
            current = lang;
            const milliseconds = label('settingsProbe.milliseconds', lang).replace('{{value}}', '961');
            await expect(probe.getByRole('cell', { name: new RegExp(`${label('settingsProbe.latency', lang)}.*${milliseconds}`) })).toBeVisible();
            await expect(probe.getByText(milliseconds, { exact: true })).toBeVisible();
            await expect(probe.getByText(label('settingsProbe.warnings', lang), { exact: true })).toBeVisible();
            await expect(probe.getByText(/context_warnings|context_window_unknown|latency_ms/)).toHaveCount(0);
        }
    });
});

test('Japanese is offered alongside the other languages and renders its own dictionary', async ({ page }) => {
    await page.goto('/static/app/#/dashboard');
    await ready(page);
    await page.getByRole('button', { name: 'en-US', exact: true }).click();
    for (const name of ['English', '日本語']) await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText('简体中文', { exact: true })).toHaveCount(0);
    await page.getByText('日本語', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja-JP');
    await expect(page.getByRole('button', { name: 'ja-JP', exact: true })).toBeVisible();
    await expect(page.locator('.cs-page-title')).toHaveText(label('nav.dashboard', 'ja-JP'));
});

test.describe('update source management', () => {
    test.use({ appPermissions: [...UI_PERMISSIONS, 'update:apply'] });

    test('save errors keep the draft and clearing the address restores the default without running an update', async ({ page, mockApi }) => {
        mockUpdateStatus(mockApi);
        await page.goto('/static/app/#/settings?section=update');
        const main = await ready(page);
        const address = main.getByRole('textbox', { name: 'Update source repository address' });
        await expect(address).toHaveValue(currentRepo);
        await expect(main.getByText('Build pending', { exact: false }).first()).toBeVisible();
        const save = main.getByRole('button', { name: 'Save source', exact: true });
        await expect(save).toBeDisabled();

        await address.fill(' ' + newRepo + ' ');
        mockApi.fail('POST', '/api/system/update/source', 'Sample address cannot be saved right now');
        await save.click();
        await expect(main.getByText('Sample address cannot be saved right now', { exact: true })).toBeVisible();
        await expect(address).toHaveValue(' ' + newRepo + ' ');

        mockApi.respond('POST', '/api/system/update/source', { json: {
            source: { repo: newRepo, configured: true, defaultRepo }
        } });
        await save.click();
        await expect(address).toHaveValue(newRepo);
        await expect(main.getByText(newRepo, { exact: true })).toBeVisible();

        await address.clear();
        mockApi.respond('POST', '/api/system/update/source', { json: {
            source: { repo: '', configured: false, defaultRepo }
        } });
        await save.click();
        await expect(main.getByText(defaultRepo, { exact: true })).toBeVisible();
        await expect(save).toBeDisabled();
        expect(mockApi.writes().map(({ path, body }) => [path, body])).toEqual([
            ['/api/system/update/source', { repo: newRepo }],
            ['/api/system/update/source', { repo: newRepo }],
            ['/api/system/update/source', { repo: '' }]
        ]);
    });
});

test('update viewers can read the source and see the server configuration location', async ({ page, mockApi }) => {
    mockUpdateStatus(mockApi);
    await page.goto('/static/app/#/settings?section=update');
    const main = await ready(page);
    const address = main.getByRole('textbox', { name: 'Update source repository address' });
    await expect(address).toHaveValue(currentRepo);
    await expect(address).toHaveAttribute('readonly', '');
    await expect(main.getByRole('button', { name: 'Save source', exact: true })).toHaveCount(0);
    await expect(main.getByText(/change update\.repo/)).toBeVisible();
    expect(mockApi.writes()).toEqual([]);
});
