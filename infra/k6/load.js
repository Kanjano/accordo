// Load test (SPEC §15.1): search 200 req/s with p95 < 300 ms, listing page 100 req/s, on the
// 100 000-listing seed. Run against production builds, see docs/RUNBOOK.md ("Test di carico"):
//   docker run --rm -i -e API=http://host.docker.internal:4000 -e WEB=http://host.docker.internal:3000 \
//     grafana/k6:2.2.0 run - < infra/k6/load.js

import { check } from 'k6';
import http from 'k6/http';

const API = __ENV.API || 'http://localhost:4000';
const WEB = __ENV.WEB || 'http://localhost:3000';
const DURATION = __ENV.DURATION || '60s';

const QUERIES = [
  'q=fender',
  'q=stratocster',
  'q=gibson%20custom&sort=price_asc',
  'q=yamaha&condition=NEW,EXCELLENT',
  'department=chitarre',
  'category=chitarre-elettriche&brand=fender',
  'comune=015146&radiusKm=30&sort=distance',
  'q=roland&comune=058091&radiusKm=50',
  'priceMin=100&priceMax=500&sort=price_desc',
  'region=lombardia&shipping=true&page=3',
  '',
];

export const options = {
  scenarios: {
    search: {
      executor: 'constant-arrival-rate',
      exec: 'search',
      rate: 200,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
    listing: {
      executor: 'constant-arrival-rate',
      exec: 'listing',
      rate: 100,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
  },
  thresholds: {
    'http_req_duration{scenario:search}': ['p(95)<300'],
    'http_req_failed{scenario:search}': ['rate<0.01'],
    'http_req_failed{scenario:listing}': ['rate<0.01'],
    'dropped_iterations{scenario:search}': ['count<200'],
    'dropped_iterations{scenario:listing}': ['count<100'],
  },
};

/** A pool of real listing pages, taken from a few result pages. */
export function setup() {
  const paths = [];
  for (let page = 1; page <= 10; page++) {
    const res = http.get(`${API}/api/v1/search/listings?sort=newest&page=${page}`);
    for (const hit of res.json('hits') || []) paths.push(`/annuncio/${hit.slug}-${hit.shortId}`);
  }
  if (!paths.length) throw new Error('No listings: seed the database and reindex');
  return { paths };
}

export function search() {
  const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const res = http.get(`${API}/api/v1/search/listings?${q}`, { tags: { name: 'search' } });
  check(res, { 'search 200': (r) => r.status === 200 });
}

export function listing(data) {
  const path = data.paths[Math.floor(Math.random() * data.paths.length)];
  const res = http.get(`${WEB}${path}`, { tags: { name: 'listing' } });
  check(res, { 'listing 200': (r) => r.status === 200 });
}
