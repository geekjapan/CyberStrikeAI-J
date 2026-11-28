#!/usr/bin/env node
// Run one journey against the instance started by launch.sh and save evidence.
//   node .claude/skills/verify-cyberstrikeai/drive.mjs <journey.mjs>
// A journey is a module:  export default async ({ page, expect, shot, api, base, login }) => { ... }
// Add `export const login = false` to start on the login page instead of signed in.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
// Playwright is the frontend's dev dependency; it drives the installed Chrome
// (channel "chrome"), the same as web/frontend/playwright.config.mjs.
const { chromium, expect } = createRequire(resolve(repo, 'web/frontend/package.json'))('@playwright/test');

const journeyPath = process.argv[2];
if (!journeyPath) { console.error('usage: drive.mjs <journey.mjs>'); process.exit(2); }
const name = basename(journeyPath, '.mjs');
const journey = await import(pathToFileURL(resolve(journeyPath)).href);

const read = f => readFileSync(resolve(here, '.run', f), 'utf8').trim();
let base, password;
try { base = `http://127.0.0.1:${read('port')}`; password = read('admin-password'); }
catch { console.error('no running instance: run launch.sh first'); process.exit(2); }

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const out = resolve(here, 'evidence', `${stamp}-${name}`);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const calls = [];
page.on('response', r => {
    const q = r.request();
    if (r.url().includes('/api/') && q.method() !== 'GET') calls.push(`${r.status()} ${q.method()} ${new URL(r.url()).pathname}`);
});

let n = 0;
const shots = [];
const shot = async label => {
    const file = `${String(++n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: resolve(out, file) });
    shots.push(file);
};
// Sign in through the real form.  The fields are addressed by position and
// type so the helper works in every UI language.
const login = async () => {
    await page.goto(base + '/');
    const form = page.locator('.cs-login-form');
    await form.locator('input').first().fill('admin');
    await form.locator('input[type=password]').fill(password);
    await form.locator('button[type=submit]').click();
    await page.locator('#main-content').waitFor();
};
// Read server state with the signed-in user's token, to check side effects.
const api = async path => {
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('cyberstrike-auth') || '{}').token);
    const r = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return r.json();
};

const git = (...a) => execFileSync('git', ['-C', repo, ...a]).toString().trim();
const result = { journey: name, base, commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '', started: new Date().toISOString(), ok: false };
try {
    if (journey.login !== false) await login();
    result.observed = await journey.default({ page, expect, shot, api, base, login }) ?? null;
    result.ok = true;
} catch (e) {
    result.error = String(e.message || e).replaceAll(password, '<redacted>');
    await shot('FAILED').catch(() => {});
}
await browser.close();
result.screenshots = shots;
result.writes = calls;
writeFileSync(resolve(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`${result.ok ? 'PASS' : 'FAIL'} ${name}  evidence: ${out}`);
if (!result.ok) console.log(result.error);
process.exit(result.ok ? 0 : 1);
