// UI tests of the real renderer in Chromium, driven by synthetic replay traces
// through an in-memory bridge. No camera, no SDK, no credits.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function spyCamera(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __gumCalls: number };
    w.__gumCalls = 0;
    const md = navigator.mediaDevices;
    if (md) {
      const orig = md.getUserMedia?.bind(md);
      md.getUserMedia = (c?: MediaStreamConstraints) => {
        w.__gumCalls++;
        return orig ? orig(c) : Promise.reject(new Error('no camera'));
      };
    }
  });
}
const gumCalls = (page: Page) => page.evaluate(() => (window as unknown as { __gumCalls: number }).__gumCalls);

async function startReplay(page: Page, scenario: string, mode: 'Quick' | 'Full', speed = 8) {
  await page.goto(`/?speed=${speed}`);
  await page.getByRole('radio', { name: new RegExp(`^${mode}`) }).click();
  await page.getByTestId(`scenario-${scenario}`).check();
  await page.getByTestId('check-in').click();
  await expect(page.getByTestId('consent')).toBeVisible();
  await page.getByTestId('consent-start').click();
}

test('the camera is never requested before consent (and never in replay)', async ({ page }) => {
  await spyCamera(page);
  await page.goto('/');
  await page.getByTestId('scenario-clean').check();
  await page.getByTestId('check-in').click();
  await expect(page.getByTestId('consent')).toBeVisible();
  expect(await gumCalls(page)).toBe(0);
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByTestId('check-in')).toBeVisible();
  expect(await gumCalls(page)).toBe(0);
});

test('clean full replay: progressive results, receipts, auto-complete', async ({ page }) => {
  await startReplay(page, 'clean', 'Full');
  await expect(page.getByTestId('measuring-banner')).toBeVisible();
  await expect(page.getByTestId('replay-badge')).toContainText('synthetic');
  await expect(page.getByTestId('value-pulse')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('value-hrv')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screens/measuring-clean.png' });
  await expect(page.getByTestId('value-breathing')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('value-hrv')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('complete')).toBeVisible();
  await page.getByTestId('receipt-pulse').click();
  const dialog = page.getByRole('dialog', { name: 'Evidence receipt' });
  await expect(dialog).toContainText('VERIFIED');
  await expect(dialog).toContainText('STEADY LIGHT');
  await page.screenshot({ path: 'test-results/screens/receipt.png' });
});

test('talking: breathing withheld with a plain reason and a countdown', async ({ page }) => {
  await startReplay(page, 'talking', 'Full', 4);
  await expect(page.getByTestId('reason-breathing')).toContainText('You spoke', { timeout: 20_000 });
  await expect(page.getByTestId('reason-breathing')).toContainText(/in \d+ s/);
  await expect(page.getByTestId('coaching')).toContainText('Restarting the 30-s window');
  await page.screenshot({ path: 'test-results/screens/withheld-talking.png' });
});

test('flicker at 72/min: pulse withheld, light patches flagged', async ({ page }) => {
  await startReplay(page, 'flicker72', 'Quick', 4);
  await expect(page.getByTestId('coaching')).toContainText(/flickering at about 7\d\/min/, { timeout: 15_000 });
  await expect(page.getByTestId('value-pulse')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screens/withheld-flicker.png' });
});

test('a second face pauses the session', async ({ page }) => {
  await startReplay(page, 'multiple_faces', 'Full', 4);
  await expect(page.getByTestId('measuring-banner')).toContainText('Paused', { timeout: 15_000 });
  await expect(page.getByRole('alert')).toContainText('Someone else came into view');
  await expect(page.getByTestId('measuring-banner')).toContainText('Measuring', { timeout: 10_000 });
});

test('hiding the window stops measuring at once', async ({ page }) => {
  await startReplay(page, 'clean', 'Full', 1);
  await expect(page.getByTestId('measuring-banner')).toBeVisible();
  await page.evaluate(() => (window as unknown as { __witnessHide: () => void }).__witnessHide());
  await expect(page.getByTestId('measuring-banner')).toHaveCount(0, { timeout: 1000 });
  await expect(page.getByTestId('complete')).toBeVisible();
});

test('history shows saved check-ins and the SDK-alone ghost overlay', async ({ page }) => {
  await startReplay(page, 'talking', 'Full', 8);
  await expect(page.getByTestId('complete')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('h');
  const sheet = page.getByTestId('history');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('ghost-dot')).toHaveCount(0);
  await page.getByTestId('ghost-toggle').check();
  expect(await page.getByTestId('ghost-dot').count()).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/screens/history-ghosts.png' });
});

test('delete everything needs a 1.5 s hold', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('check-in')).toBeVisible();
  await page.keyboard.press('d');
  const btn = page.getByTestId('delete-all');
  await btn.hover();
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await expect(page.getByTestId('deleted')).toHaveCount(0);
  await page.mouse.down();
  await page.waitForTimeout(1700);
  await page.mouse.up();
  await expect(page.getByTestId('deleted')).toBeVisible();
});

for (const scheme of ['dark', 'light'] as const) {
  test(`no serious accessibility violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/?speed=8');
    const home = await new AxeBuilder({ page }).analyze();
    await page.getByTestId('scenario-clean').check();
    await page.getByTestId('check-in').click();
    const consent = await new AxeBuilder({ page }).analyze();
    await page.getByTestId('consent-start').click();
    await expect(page.getByTestId('value-pulse')).toBeVisible({ timeout: 10_000 });
    const measuring = await new AxeBuilder({ page }).analyze();
    await page.screenshot({ path: `test-results/screens/measuring-${scheme}.png` });
    const serious = [...home.violations, ...consent.violations, ...measuring.violations].filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
