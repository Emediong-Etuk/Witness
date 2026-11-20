// Judge site: real pages, real CSP (meta), real verifier in a Web Worker.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ROUTES = ['/', '/replay', '/verify', '/results', '/run', '/privacy', '/tools/flicker'];

function watch(page: Page) {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol !== 'data:' && u.protocol !== 'blob:') external.push(r.url());
  });
  return { errors, external };
}

test('every route renders by deep link, with no errors and no third-party requests', async ({ page }) => {
  const w = watch(page);
  for (const r of ROUTES) {
    await page.goto(r);
    await expect(page.locator('main h1, main h2').first()).toBeVisible();
    await page.waitForTimeout(300);
  }
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
});

test('no invented numbers: headline values are TBD until results exist', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-tour="measured"] .tbd')).toHaveCount(4);
  await expect(page.getByTestId('video-pitch')).toContainText('Publishing');
});

test('guided tour walks every step across pages, then finishes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tour-start').click();
  const card = page.getByTestId('tour-card');
  await expect(card).toContainText('Step 1 of 20');
  const seenRoutes = new Set<string>();
  for (let i = 1; i < 20; i++) {
    if (i % 2) await page.getByTestId('tour-next').click();
    else await page.keyboard.press('ArrowRight');
    await expect(card).toContainText(`Step ${i + 1} of 20`);
    seenRoutes.add(new URL(page.url()).pathname);
  }
  expect([...seenRoutes].sort()).toEqual(['/', '/privacy', '/replay', '/results', '/run', '/tools/flicker', '/verify']);
  await expect(card).toContainText("That's the tour");
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour')).toHaveCount(0);
});

test('tour: Back works, Esc closes, highlighted controls stay usable', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tour-start').click();
  for (let i = 0; i < 4; i++) await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-card')).toContainText('Why a short disturbance matters');
  // interact with the spotlighted explainer while the tour is open
  await page.getByRole('button', { name: 'You chew gum' }).click();
  await expect(page.getByRole('button', { name: 'You chew gum' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('tour-card')).toContainText('Start with the videos');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour')).toHaveCount(0);
});

test('window explainer responds to the keyboard', async ({ page }) => {
  await page.goto('/');
  const slider = page.getByRole('slider', { name: /Disturbance/ });
  await slider.scrollIntoViewIfNeeded();
  const before = await page.locator('[data-tour="explainer"]').innerText();
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '30');
  expect(await page.locator('[data-tour="explainer"]').innerText()).not.toBe(before);
});

test('Replay Lab: talking scenario shows SDK-stable readings withheld, and a receipt opens', async ({ page }) => {
  await page.goto('/replay');
  await page.getByTestId('replay-talking').click();
  const withheld = page.locator('[data-testid="dot-breathing-WITHHELD"]');
  expect(await withheld.count()).toBeGreaterThan(5);
  await withheld.first().click();
  await expect(page.getByTestId('receipt-drawer')).toContainText('WITHHELD');
  await expect(page.getByTestId('receipt-drawer')).toContainText('QUIET');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('replay-play').click();
  await expect(page.getByTestId('replay-play')).toContainText('Pause');
});

test('Verify: published corpus passes in the browser', async ({ page }) => {
  await page.goto('/verify');
  await page.getByTestId('verify-run').click();
  await expect(page.getByTestId('verify-summary')).toContainText('OK', { timeout: 60_000 });
});

test('Verify: tampering with a README number is caught and listed first', async ({ page }) => {
  await page.goto('/verify');
  await page.getByTestId('tamper-doc').click();
  await page.getByTestId('tamper-run').click();
  await expect(page.getByTestId('verify-summary')).toContainText('FAILED', { timeout: 60_000 });
  await expect(page.getByTestId('verify-checks').locator('li').first()).toContainText('docs.README.md');
  await page.getByTestId('tamper-none').click();
  await page.getByTestId('tamper-run').click();
  await expect(page.getByTestId('verify-summary')).toContainText('OK', { timeout: 60_000 });
});

test('Verify: a sample exported check-in verifies', async ({ page }) => {
  await page.goto('/verify');
  await page.getByTestId('checkin-sample').click();
  await expect(page.locator('[data-tour="verify-checkin"] [data-testid="verify-summary"]')).toContainText('all 1 receipts are intact', { timeout: 30_000 });
});

test('flicker tool is gated by a photosensitivity warning', async ({ page }) => {
  await page.goto('/tools/flicker');
  await expect(page.getByTestId('flicker-start')).toHaveCount(0);
  await page.getByTestId('flicker-ok').click();
  await page.getByTestId('flicker-start').click();
  await expect(page.getByTestId('flicker-stage')).toBeVisible();
  await page.getByTestId('flicker-stage').click();
  await expect(page.getByTestId('flicker-stage')).toBeHidden();
});

test('mobile: no horizontal scroll', async ({ browser }) => {
  const p = await browser.newPage({ viewport: { width: 375, height: 812 } });
  for (const r of ['/', '/replay', '/verify', '/privacy']) {
    await p.goto('http://localhost:4174' + r);
    await p.waitForTimeout(400);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(over, r).toBeLessThanOrEqual(1);
  }
  await p.close();
});

for (const scheme of ['dark', 'light'] as const) {
  test(`axe: no serious accessibility violations on any page (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const bad: string[] = [];
    for (const r of ROUTES) {
      await page.goto(r);
      await page.waitForTimeout(500);
      const res = await new AxeBuilder({ page }).analyze();
      for (const v of res.violations) if (v.impact === 'serious' || v.impact === 'critical') bad.push(`${r} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
    }
    expect(bad).toEqual([]);
  });
}
