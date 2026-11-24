// Switch the UI to Japanese from the header, confirm it survives a reload,
// then switch back to English from Settings > Appearance.
export default async ({ page, expect, shot, base }) => {
    await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible();
    await page.locator('header').getByRole('button', { name: 'en-US' }).click();
    const items = await page.getByRole('menuitem').allTextContents();
    await shot('language-menu');
    await page.getByRole('menuitem', { name: '日本語' }).click();
    await expect(page.getByText('ダッシュボード', { exact: true }).first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja-JP');
    await shot('japanese');
    await page.reload();
    await expect(page.getByText('ダッシュボード', { exact: true }).first()).toBeVisible();
    const saved = await page.evaluate(() => localStorage.getItem('csai_lang'));
    if (saved !== 'ja-JP') throw new Error(`csai_lang is ${saved}, expected ja-JP`);
    await page.waitForLoadState('networkidle');
    await shot('japanese-after-reload');

    // Second entry point: the language select in Settings > Appearance.
    await page.goto(`${base}/#/settings?section=appearance`);
    const select = page.locator('#main-content').getByRole('combobox').filter({ hasText: '日本語' });
    await select.click();
    await page.locator('.semi-select-option', { hasText: /^English$/ }).click();
    await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await shot('english-from-settings');
    return { menu: items.filter(t => /^(English|日本語|简体中文)$/.test(t)), saved };
};
