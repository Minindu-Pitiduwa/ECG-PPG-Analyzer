/**
 * Regenerate the README's screenshots and demo GIF from the built app.
 *
 *   npm run docs:capture
 *
 * Starts a preview server for the production build, drives it with Playwright,
 * writes PNGs to docs/screenshots/ and, when ffmpeg is installed, converts a
 * screen recording of a short tour into docs/demo.gif.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 4321;
const URL = `http://localhost:${PORT}/`;
const SHOTS = 'docs/screenshots';
const VIEWPORT = { width: 1280, height: 800 };

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      // not up yet
    }
    await pause(200);
  }
  throw new Error('The preview server did not start.');
}

async function openSample(page, name) {
  await page.goto(URL);
  await page.getByRole('button', { name }).click();
  await page.getByTestId('trend-plot').first().locator('canvas').waitFor();
  await pause(400);
}

async function screenshots(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
  const tab = async (name) => {
    await page.getByRole('tab', { name }).click();
    await page.getByRole('tab', { name }).scrollIntoViewIfNeeded();
    await pause(500);
  };

  await page.goto(URL);
  await page.getByText('All sample recordings').waitFor();
  await shot('landing');

  await openSample(page, /ECG: frequent ectopic beats/);
  await shot('analyze');

  await openSample(page, 'Try a sample ECG');
  await tab('HRV details');
  await page.getByRole('img', { name: /power spectrum/ }).scrollIntoViewIfNeeded();
  await shot('hrv');

  await openSample(page, /ECG: frequent ectopic beats/);
  await tab(/Rhythm flags/);
  await page.getByText('How this was computed').scrollIntoViewIfNeeded();
  await shot('flags');

  await openSample(page, 'Try a sample ECG');
  await tab('Noise lab');
  await page.getByTestId('noise-plot').locator('canvas').waitFor();
  await page.getByRole('slider', { name: /Signal-to-noise/ }).fill('6');
  await pause(1200);
  await page.getByRole('img', { name: /F1 score/ }).scrollIntoViewIfNeeded();
  await shot('noise-lab');

  await page.getByRole('button', { name: 'Report' }).click();
  await page.getByText('Settings used').waitFor();
  await shot('report');

  await context.close();
}

/** A short tour of the app, recorded as video. Returns the path of the recording. */
async function recordTour(browser, videoDir) {
  const size = { width: 1100, height: 700 };
  const context = await browser.newContext({
    viewport: size,
    recordVideo: { dir: videoDir, size },
  });
  const page = await context.newPage();
  await page.goto(URL);
  await page.getByText('All sample recordings').waitFor();
  await pause(1500);

  await page.getByRole('button', { name: 'Try a sample ECG' }).click();
  await page.getByTestId('trend-plot').first().locator('canvas').waitFor();
  await pause(1800);

  // Zoom in on a few beats, then pan along the recording.
  const box = await page.getByTestId('signal-plot').locator('.u-over').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -120);
    await pause(120);
  }
  await pause(600);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2, { steps: 25 });
  await page.mouse.up();
  await pause(900);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await pause(900);

  for (const name of ['HRV details', /Rhythm flags/, 'Noise lab']) {
    await page.getByRole('tab', { name }).click();
    await page.getByRole('tab', { name }).scrollIntoViewIfNeeded();
    await pause(1800);
  }
  const slider = page.getByRole('slider', { name: /Signal-to-noise/ });
  for (const level of ['5', '6', '7']) {
    await slider.fill(level);
    await pause(1100);
  }

  await page.getByRole('button', { name: 'Report' }).click();
  await page.getByText('Settings used').waitFor();
  await pause(2000);
  await context.close(); // finishes writing the video
  return join(
    videoDir,
    readdirSync(videoDir).find((file) => file.endsWith('.webm')),
  );
}

function toGif(video, gif) {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    console.warn('ffmpeg not found: skipped docs/demo.gif');
    return;
  }
  // A palette made from the recording itself keeps the flat UI colors clean at a small file size.
  const filter =
    'fps=8,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none';
  const result = spawnSync('ffmpeg', ['-y', '-i', video, '-vf', filter, '-loop', '0', gif], {
    stdio: 'ignore',
  });
  if (result.status !== 0) throw new Error('ffmpeg could not create the GIF.');
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
const videoDir = mkdtempSync(join(tmpdir(), 'pulsescope-tour-'));
try {
  await waitForServer();
  const browser = await chromium.launch();
  await screenshots(browser);
  toGif(await recordTour(browser, videoDir), 'docs/demo.gif');
  await browser.close();
  console.log(`wrote ${SHOTS}/*.png and docs/demo.gif`);
} finally {
  server.kill();
  rmSync(videoDir, { recursive: true, force: true });
}
