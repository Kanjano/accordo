/**
 * `pnpm search:bench`: latency of GET /api/v1/search/listings over a mix of realistic queries
 * (text with typos, facets, geo radius, sorts). Start the API with RATE_LIMIT_ENABLED=false.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootEnv = resolve(import.meta.dirname, '../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const API = process.env.API_URL ?? 'http://localhost:4000';
const RUNS = Number(process.env.BENCH_RUNS ?? 500);

const QUERIES = [
  { q: 'fender' },
  { q: 'stratocster' },
  { q: 'gibson custom', sort: 'price_asc' },
  { q: 'yamaha', condition: 'NEW,EXCELLENT' },
  { department: 'chitarre' },
  { category: 'chitarre-elettriche', brand: 'fender' },
  { comune: '015146', radiusKm: '30', sort: 'distance' },
  { q: 'roland', comune: '058091', radiusKm: '50' },
  { priceMin: '100', priceMax: '500', sort: 'price_desc' },
  { region: 'lombardia', shipping: 'true', page: '3' },
  {},
];

const times: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const query = new URLSearchParams(QUERIES[i % QUERIES.length] as Record<string, string>);
  const t0 = performance.now();
  const res = await fetch(`${API}/api/v1/search/listings?${query}`);
  const body = (await res.json()) as { degraded?: boolean; total?: number };
  times.push(performance.now() - t0);
  if (!res.ok || body.degraded)
    throw new Error(`Bad response ${res.status}: ${JSON.stringify(body)}`);
}
times.sort((a, b) => a - b);
const pct = (p: number) => (times[Math.ceil((p / 100) * times.length) - 1] as number).toFixed(1);
console.log(`${RUNS} richieste — p50 ${pct(50)} ms, p95 ${pct(95)} ms, p99 ${pct(99)} ms`);
