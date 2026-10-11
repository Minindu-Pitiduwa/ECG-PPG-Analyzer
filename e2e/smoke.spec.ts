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

test('the signal is filtered automatically and the settings can be changed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample ECG' }).click();

  const viewModes = page.getByRole('radiogroup', { name: 'Signal shown' });
  await expect(viewModes.getByRole('radio', { name: 'Filtered' })).toBeChecked();
  await viewModes.getByRole('radio', { name: 'Both' }).click();
  await expect(viewModes.getByRole('radio', { name: 'Both' })).toBeChecked();

  // An impossible setting is explained instead of breaking the page.
  await page.getByText('Advanced').click();
  await page.getByLabel('Low-pass cutoff (Hz)', { exact: true }).fill('0.2');
  await expect(page.getByRole('alert')).toContainText('above the high-pass cutoff');
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Low-pass cutoff (Hz)', { exact: true })).toHaveValue('40');

  await page.getByText('Filter frequency response').click();
  await expect(page.getByRole('img', { name: /Filter frequency response/ })).toBeVisible();
});

test('filter stages that cannot apply at a low sampling rate are skipped with a note', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample PPG' }).click();
  await page.getByLabel('Mains hum', { exact: true }).selectOption('60');
  await expect(page.getByText('The 60 Hz notch was skipped')).toBeVisible();
});

test('beats are detected, and can be corrected by hand with undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample ECG' }).click();

  // MIT-BIH record 100 has 371 annotated beats in its first five minutes.
  const beatCount = (count: string) => page.getByText(count, { exact: true });
  await expect(beatCount('371')).toBeVisible();
  await expect(page.getByText(/^74\s*bpm$/)).toBeVisible(); // mean heart rate
  await expect(page.getByTestId('trend-plot').first().locator('canvas')).toBeVisible();

  // The opening view shows 0 to 10 s; 4.6 s lies between two beats of this recording.
  const plotArea = page.getByTestId('signal-plot').locator('.u-over');
  const clickBetweenBeats = async () => {
    const box = await plotArea.boundingBox();
    if (!box) throw new Error('plot area not found');
    await page.mouse.click(box.x + box.width * 0.46, box.y + box.height * 0.5);
  };

  // Outside edit mode a click on the plot changes nothing.
  await clickBetweenBeats();
  await expect(beatCount('371')).toBeVisible();

  await page.getByRole('button', { name: 'Edit beats' }).click();
  await clickBetweenBeats(); // adds a beat
  await expect(beatCount('372')).toBeVisible();
  await clickBetweenBeats(); // the same spot now holds a marker, so this removes it
  await expect(beatCount('371')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(beatCount('372')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(beatCount('371')).toBeVisible();

  await clickBetweenBeats(); // adds it again
  await expect(beatCount('372')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(beatCount('371')).toBeVisible();
});

test('variability metrics, excluded intervals and signal quality are reported', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample ECG' }).click();

  await expect(page.getByText(/^28\s*ms$/).first()).toBeVisible(); // SDNN
  await expect(page.getByText(/^100\s*% good$/)).toBeVisible();
  await expect(page.getByText('6 intervals excluded')).toBeVisible();
  await expect(page.getByTestId('trend-plot')).toHaveCount(2); // heart rate and tachogram

  await page.getByRole('tab', { name: 'HRV details' }).click();
  await expect(page.getByText('Based on 364 normal intervals.')).toBeVisible();
  await expect(page.getByRole('img', { name: /Poincaré plot/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /power spectrum/ })).toBeVisible();
  // Just under five minutes of usable beats: LF and HF are shown, VLF is withheld with a reason.
  await expect(page.getByText('VLF power is hidden')).toBeVisible();
  await page.getByLabel('Method', { exact: true }).selectOption('welch');
  await expect(page.getByRole('img', { name: /power spectrum/ })).toBeVisible();
});

test('the disturbed stretch of the PPG sample is marked as low quality', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample PPG' }).click();
  await expect(page.getByText('1 of 30 segments low')).toBeVisible();
  await expect(page.getByText('Low signal quality')).toBeVisible();
  await page.getByRole('tab', { name: 'HRV details' }).click();
  await expect(page.getByText(/pulse rate variability/)).toBeVisible();
});

test('a recording too short for frequency analysis says why', async ({ page }) => {
  const rows = ['time_ms,ecg'];
  for (let i = 0; i < 15000; i++) {
    const phase = i % 200; // one beat every 800 ms at 250 Hz
    rows.push(`${i * 4},${phase < 3 ? 1 : phase > 60 && phase < 100 ? 0.15 : 0}`);
  }
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'one-minute.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(rows.join('\n')),
  });
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByRole('tab', { name: 'HRV details' }).click();
  await expect(page.getByText(/Frequency analysis needs at least 2 minutes/)).toBeVisible();
});

test('rhythm flags say what was found and jump to where', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /ECG: frequent ectopic beats/ }).click();

  await page.getByRole('tab', { name: 'Rhythm flags (1)' }).click();
  await expect(page.getByText(/screening hints/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Premature beats' })).toBeVisible();
  await expect(page.getByText(/77 early beats followed by a longer gap/)).toBeVisible();
  await page.getByText('How this was computed').click();
  await expect(page.getByText(/20% shorter than the median/)).toBeVisible();

  const minimap = page.getByTestId('minimap');
  await expect(minimap).toHaveAttribute('aria-valuetext', 'Showing 0:00 to 0:10');
  await page.getByRole('button', { name: '0:36', exact: true }).click();
  await expect(minimap).toHaveAttribute('aria-valuetext', /Showing 0:3\d to 0:4\d/);

  // Thresholds are adjustable: this 66 bpm rhythm counts as slow once slow means below 90.
  await expect(page.getByRole('heading', { name: 'Slow rate' })).toHaveCount(0);
  await page.getByLabel('Slow below (bpm)').fill('90');
  await expect(page.getByRole('heading', { name: 'Slow rate' })).toBeVisible();
});

test('the noise lab shows detection degrading as noise is added', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample ECG' }).click();
  await page.getByRole('tab', { name: 'Noise lab' }).click();

  await expect(page.getByTestId('noise-plot').locator('canvas')).toBeVisible();
  await expect(page.getByRole('img', { name: /F1 score against signal-to-noise/ })).toBeVisible();
  // At 0 dB of muscle noise every beat of this recording is still found.
  await expect(page.getByText('0 missed, 0 extra, out of 371 beats.')).toBeVisible();

  await page.getByRole('slider', { name: /Signal-to-noise ratio/ }).fill('7'); // loudest level
  await expect(page.getByText(/Signal-to-noise ratio: -18 dB/)).toBeVisible();
  await expect(page.getByText(/\d+ missed, \d{2,} extra, out of 371 beats\./)).toBeVisible();
});
