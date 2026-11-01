/**
 * `pnpm perf:budget`: lab check of the performance budget (SPEC §12.4) on a production build —
 * LCP < 2.5 s and CLS < 0.1 on a throttled mobile profile (Lighthouse "slow 4G", 4× CPU), and
 * listing-page JavaScript < 180 KB compressed. INP needs real interactions: watch it in the field.
 * Start `next start` and the API first (see docs/RUNBOOK.md, "Prestazioni").
 */
import { chromium, devices } from '@playwright/test';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const BUDGET = { lcpMs: 2500, cls: 0.1, listingJsKb: 180 };

const hit = (await (await fetch(`${API}/api/v1/search/listings?sort=newest`)).json()).hits[0];
const pages = {
  home: '/',
  search: '/annunci?q=fender',
  listing: `/annuncio/${hit.slug}-${hit.shortId}`,
};

const browser = await chromium.launch();
const failures: string[] = [];
for (const [name, path] of Object.entries(pages)) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  // The consent banner is part of the real first visit, so it stays.
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // Compressed body bytes of every script the page downloads (lazy chunks included).
  const scripts = new Map<string, { url: string; bytes: number }>();
  cdp.on('Network.responseReceived', (e) => {
    if (e.type === 'Script') scripts.set(e.requestId, { url: e.response.url, bytes: 0 });
  });
  cdp.on('Network.dataReceived', (e) => {
    const s = scripts.get(e.requestId);
    if (s) s.bytes += e.encodedDataLength;
  });
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
  const vitals = await page.evaluate(
    () =>
      new Promise<{ lcp: number; cls: number }>((done) => {
        let lcp = 0;
        let cls = 0;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) lcp = e.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries() as Array<
            PerformanceEntry & { value: number; hadRecentInput: boolean }
          >)
            if (!e.hadRecentInput) cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => done({ lcp, cls }), 500);
      }),
  );
  const jsBytes = [...scripts.values()].reduce((a, s) => a + s.bytes, 0);
  if (process.env.VERBOSE)
    for (const s of scripts.values()) console.log(`  ${Math.round(s.bytes / 1024)} KB ${s.url}`);
  const kb = Math.round(jsBytes / 1024);
  console.log(
    `${name.padEnd(8)} LCP ${Math.round(vitals.lcp)} ms · CLS ${vitals.cls.toFixed(3)} · JS ${kb} KB`,
  );
  if (vitals.lcp > BUDGET.lcpMs) failures.push(`${name}: LCP ${Math.round(vitals.lcp)} ms`);
  if (vitals.cls > BUDGET.cls) failures.push(`${name}: CLS ${vitals.cls.toFixed(3)}`);
  if (name === 'listing' && kb > BUDGET.listingJsKb) failures.push(`listing: JS ${kb} KB`);
  await context.close();
}
await browser.close();
if (failures.length) {
  console.error(`Budget superato:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Budget di prestazioni rispettato.');
