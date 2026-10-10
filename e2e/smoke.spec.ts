import { expect, test } from '@playwright/test';

test('a first-time visitor can open a sample ECG and explore it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Not a medical device')).toBeVisible();

  await page.getByRole('button', { name: 'Try a sample ECG' }).click();

  await expect(page.getByRole('heading', { name: 'ECG: normal sinus rhythm' })).toBeVisible();
  await expect(page.getByTestId('signal-plot').locator('canvas')).toBeVisible();
  await expect(page.getByText('360')).toBeVisible();

  const minimap = page.getByTestId('minimap');
  await expect(minimap).toHaveAttribute('aria-valuetext', 'Showing 0:00 to 0:10');
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(minimap).toHaveAttribute('aria-valuetext', 'Showing 0:00 to 5:00');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(minimap).toHaveAttribute('aria-valuetext', 'Showing 0:00 to 0:10');
});

test('a CSV file can be imported with the sampling rate taken from its time column', async ({
  page,
}) => {
  const rows = ['time_ms,ecg'];
  for (let i = 0; i < 5000; i++) {
    // A crude 75 bpm spike train is enough to exercise the import path.
    rows.push(`${i * 4},${i % 200 < 4 ? 1 : 0.02 * Math.sin(i / 9)}`);
  }
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'my-recording.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(rows.join('\n')),
  });

  await expect(page.getByRole('heading', { name: 'Import my-recording.csv' })).toBeVisible();
  await expect(page.getByLabel('Sampling rate (Hz)')).toHaveValue('250');
  await expect(page.getByLabel('Time column', { exact: true })).toHaveValue('0');

  await page.getByRole('button', { name: 'Import' }).click();

  await expect(page.getByRole('heading', { name: 'my-recording.csv' })).toBeVisible();
  await expect(page.getByText('20 s')).toBeVisible();
});

test('an unusable file produces a friendly message instead of a crash', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'notes.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,comment\nalice,hello\nbob,world\n'),
  });
  await expect(page.getByRole('alert')).toContainText('No numeric signal column');
});
