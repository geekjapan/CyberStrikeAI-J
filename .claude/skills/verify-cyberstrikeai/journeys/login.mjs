// A wrong password is rejected and stays on the form; the right one opens the app.
export const login = false;
export default async ({ page, expect, shot, base, login }) => {
    await page.goto(base + '/');
    const form = page.locator('.cs-login-form');
    await form.locator('input').first().fill('admin');
    await form.locator('input[type=password]').fill('wrong-on-purpose');
    await form.locator('button[type=submit]').click();
    await expect(form.locator('.semi-form-field-error-message, [role=alert]').first()).toBeVisible();
    await expect(page.locator('#main-content')).toHaveCount(0);
    const rejected = (await form.locator('.semi-form-field-error-message, [role=alert]').first().textContent()).trim();
    await shot('rejected');

    await login();
    await expect(page).toHaveURL(/#\/dashboard$/);
    await expect(page.locator('#main-content')).toBeVisible();
    await shot('dashboard');
    const stored = await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('cyberstrike-auth') || '{}').token));
    if (!stored) throw new Error('signed in but no token in localStorage["cyberstrike-auth"]');
    return { rejected };
};
