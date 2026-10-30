/**
 * Builds packages/db/data/comuni.json (all comuni) and capoluoghi.json (offline fallback).
 * Sources (see docs/DATA_SOURCES.md):
 *  - ISTAT "Elenco dei codici e delle denominazioni delle unità territoriali" (CC BY 4.0)
 *  - Wikidata coordinates (P625) and postal codes (P281) by ISTAT code (P635) (CC0)
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { slugify } from '@accordo/domain';

const ISTAT_URL =
  'https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv';
const WIKIDATA_URL = 'https://query.wikidata.org/sparql';
const SPARQL = `SELECT ?istat ?coord (GROUP_CONCAT(DISTINCT ?cap; separator=",") AS ?caps) WHERE {
  ?c wdt:P635 ?istat; wdt:P31 wd:Q747074; wdt:P625 ?coord.
  OPTIONAL { ?c wdt:P281 ?cap }
  FILTER NOT EXISTS { ?c wdt:P576 ?end }
} GROUP BY ?istat ?coord`;
const OUT_DIR = resolve(import.meta.dirname, '../packages/db/data');

/** Minimal RFC 4180 parser (quoted fields may contain separators and newlines). */
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

/** "Bolzano/Bozen" → "Bolzano"; "Valle d'Aosta/Vallée d'Aoste" → "Valle d'Aosta". */
const italianName = (name: string) => (name.split('/')[0] ?? name).trim();

function expandCaps(raw: string): string[] {
  const caps = new Set<string>();
  for (const part of raw.split(',')) {
    const range = /^(\d{5})\s*[-–]\s*(\d{5})$/.exec(part.trim());
    if (range?.[1] && range[2]) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (to >= from && to - from <= 300)
        for (let n = from; n <= to; n++) caps.add(String(n).padStart(5, '0'));
    } else if (/^\d{5}$/.test(part.trim())) caps.add(part.trim());
  }
  return [...caps].sort();
}

async function main() {
  const [istatRes, wdRes] = await Promise.all([
    fetch(ISTAT_URL),
    fetch(`${WIKIDATA_URL}?query=${encodeURIComponent(SPARQL)}`, {
      headers: { accept: 'text/csv', 'user-agent': 'accordo-geo-import/1.0 (development)' },
    }),
  ]);
  if (!istatRes.ok || !wdRes.ok)
    throw new Error(`Download failed: ISTAT ${istatRes.status}, Wikidata ${wdRes.status}`);
  const istat = parseCsv(
    new TextDecoder('windows-1252').decode(await istatRes.arrayBuffer()),
    ';',
  ).slice(1);
  const wd = parseCsv(await wdRes.text(), ',').slice(1);

  const geo = new Map<string, { lat: number; lng: number; caps: string[] }>();
  for (const [code, coord, caps] of wd) {
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(coord ?? '');
    if (!code || !m || geo.has(code)) continue;
    geo.set(code, { lng: Number(m[1]), lat: Number(m[2]), caps: expandCaps(caps ?? '') });
  }

  const regioni = new Map<string, { id: string; name: string; slug: string }>();
  const province = new Map<
    string,
    { id: string; sigla: string; name: string; slug: string; regioneId: string }
  >();
  const comuni = istat.map((c) => {
    const [regioneId = '', provinciaId = '', , , id = ''] = c;
    const name = c[6] ?? '';
    regioni.set(regioneId, {
      id: regioneId,
      name: italianName(c[10] ?? ''),
      slug: slugify(italianName(c[10] ?? '')),
    });
    province.set(provinciaId, {
      id: provinciaId,
      sigla: c[14] ?? '',
      name: italianName(c[11] ?? ''),
      slug: slugify(italianName(c[11] ?? '')),
      regioneId,
    });
    const g = geo.get(id);
    return {
      id,
      name,
      slug: slugify(name),
      provinciaId,
      codiceCatastale: c[19] || null,
      isCapoluogo: c[13] === '1',
      caps: g?.caps ?? [],
      lat: g?.lat ?? null,
      lng: g?.lng ?? null,
    };
  });

  const meta = { retrievedAt: new Date().toISOString(), sources: [ISTAT_URL, WIKIDATA_URL] };
  const data = { meta, regioni: [...regioni.values()], province: [...province.values()] };
  await writeFile(resolve(OUT_DIR, 'comuni.json'), `${JSON.stringify({ ...data, comuni })}\n`);
  await writeFile(
    resolve(OUT_DIR, 'capoluoghi.json'),
    `${JSON.stringify({ ...data, comuni: comuni.filter((c) => c.isCapoluogo) }, null, 1)}\n`,
  );
  const missing = comuni.filter((c) => c.lat === null).length;
  console.log(
    `${regioni.size} regioni, ${province.size} province, ${comuni.length} comuni (${missing} without coordinates)`,
  );
}

await main();
