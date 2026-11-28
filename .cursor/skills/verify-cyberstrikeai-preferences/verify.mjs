#!/usr/bin/env node
import languageJourney from '../../../.claude/skills/verify-cyberstrikeai/journeys/language.mjs';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const frontend = path.join(root, 'web/frontend');
const { chromium, expect } = createRequire(path.join(frontend, 'package.json'))('@playwright/test');
const evidence = mkdtempSync(path.join(process.env.VERIFY_EVIDENCE_DIR || tmpdir(), 'csai-ui-proof-'));
const scratch = mkdtempSync(path.join(tmpdir(), 'csai-ui-app-'));
const record = (name, value) => writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
console.log('Evidence', evidence);
let child, browser, closed;
try {
    execFileSync('go', ['build', '-o', path.join(scratch, 'server'), './cmd/server'], { cwd: root, stdio: 'inherit' });
    const worker = execFileSync('go', ['run', './cmd/build-runtime', '-root', 'runtime/pi'], {cwd: root, encoding:'utf8'}).trim().split('\n').at(-1);
    const assets = path.join(scratch, 'web/static');
    mkdirSync(assets, { recursive: true });
    for (const item of ['i18n', 'favicon.ico', 'logo.png', 'site.webmanifest'])
        cpSync(path.join(root, 'web/static', item), path.join(assets, item), { recursive: true });
    execFileSync('npm', ['run', 'build', '--', '--outDir', path.join(assets, 'app')], { cwd: frontend, stdio: 'inherit' });

    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    const origin = 'http://127.0.0.1:' + port;
    writeFileSync(path.join(scratch, 'config.yaml'), `server: {host: 127.0.0.1, port: ${port}}
database: {path: data/conversations.db}
log: {level: error, output: stdout, diagnostic_disabled: true}
agent_runtime:
  worker_path: ${JSON.stringify(worker)}
c2: {enabled: false}
mcp: {enabled: false}
ai:
  default_channel: local
  channels:
    local: {base_url: "http://127.0.0.1:9/v1", api_key: fixture, model: fixture}
`);
    for (const name of ['tools', 'roles', 'agents', 'skills']) mkdirSync(path.join(scratch, name));
    child = spawn(path.join(scratch, 'server'), ['-http'], { cwd: scratch,
        env: { HOME: scratch, PATH: process.env.PATH, GIN_MODE: 'release', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'] });
    closed = once(child, 'close');
    let startup = '';
    const capture = chunk => { startup = (startup + chunk).slice(-65536); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    let password;
    await expect.poll(() => {
        if (child.exitCode !== null) throw Error('Server exited: ' + startup.split('\n').filter(line => /error|failed/i.test(line) && !/password|token|api.key/i.test(line)).slice(-2).join('\n'));
        password = startup.match(/^\s*Password\s+(\S+)/m)?.[1];
        if (!password) return false;
        try {
            return execFileSync('lsof', ['-nP', '-a', '-p', String(child.pid), '-iTCP:' + port, '-sTCP:LISTEN'], {stdio: ['ignore','pipe','ignore']}).includes('127.0.0.1:' + port);
        } catch { return false; }
    }, {timeout: 30000}).toBe(true);
    browser = await chromium.launch({channel: 'chrome'});
    const page = await browser.newPage({locale: 'en-US', colorScheme: 'light', viewport:{width:1440,height:900}});
    page.setDefaultTimeout(10000);
    await page.goto(origin + '/');
    const username = page.getByLabel('Username', {exact: true});
    await expect(username).toBeVisible();
    record('doctor.json', {pid: child.pid, origin, loginForm: true, build: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding:'utf8'}).trim()});
    await username.fill('admin');
    await page.getByLabel('Password', {exact:true}).fill(password);
    const [login] = await Promise.all([page.waitForResponse(r => r.url() === origin + '/api/auth/login' && r.request().method() === 'POST'),
        page.locator('.cs-login-form button[type=submit]').click()]);
    assert.equal(login.status(), 200);
    const header = page.locator('.cs-header');
    await expect(header).toBeVisible();
    await page.screenshot({path:path.join(evidence,'signed-in.png')});

    await header.getByRole('button', {name:'System', exact:true}).click();
    await page.screenshot({path:path.join(evidence,'theme-menu.png')});
    await page.getByRole('menuitem', {name:'Dark', exact:true}).click();
    await page.reload();
    await expect(header.getByRole('button', {name:'Dark', exact:true})).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('theme-mode','dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('cyberstrike-theme')), 'dark');
    await page.screenshot({path:path.join(evidence,'dark-after-reload.png')});
    record('theme.json', {action:'System > Dark > reload', storage:'dark', bodyTheme:'dark'});

    const language = await languageJourney({ page, expect, base:origin,
        shot:label => page.screenshot({path:path.join(evidence,label + '.png')}) });
    record('language.json', language);
    await page.getByRole('radio', {name:'Light',exact:true}).check();
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('theme-mode','light');
    await expect(page.getByRole('radio', {name:'Light',exact:true})).toBeChecked();
    assert.equal(await page.evaluate(() => localStorage.getItem('cyberstrike-theme')), 'light');
    await page.screenshot({path:path.join(evidence,'settings-light.png')});
    record('theme-settings.json', {action:'Settings > Appearance > Light > reload',storage:'light'});

    await page.locator('.cs-user-trigger').click();
    const [logout] = await Promise.all([
        page.waitForResponse(r => r.url() === origin + '/api/auth/logout' && r.request().method() === 'POST'),
        page.getByRole('menuitem', {name:/Sign out$/}).click()
    ]);
    assert.equal(logout.status(), 200);
    await expect(username).toBeVisible();
    assert.equal(await page.evaluate(() => localStorage.getItem('cyberstrike-auth') === null), true);
    await page.screenshot({path:path.join(evidence,'signed-out.png')});
    record('session.json', {actions:['Sign in','reload','Sign out'],loginStatus:200,logoutStatus:200,localSessionCleared:true});
} finally {
    try { await browser?.close(); }
    finally {
        if (child && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
            try { await closed; } finally { clearTimeout(killer); }
        }
        rmSync(scratch, {recursive:true, force:true});
    }
}
console.log('PASS', evidence);
