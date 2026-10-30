import type { SearchQuery } from '@accordo/shared';

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Next.js searchParams → URL-shaped query (empty values dropped). */
export function toQuery(raw: RawSearchParams): SearchQuery {
  const out: SearchQuery = {};
  for (const [k, v] of Object.entries(raw)) {
    const values = [v ?? []].flat().filter(Boolean);
    if (values.length) out[k] = values.length === 1 ? (values[0] as string) : values;
  }
  return out;
}

export function queryString(q: SearchQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) for (const value of [v].flat()) p.append(k, value);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Sets (or removes, with null/[]) one parameter; any filter change goes back to page 1. */
export function withParam(
  q: SearchQuery,
  key: string,
  value: string | string[] | null,
): SearchQuery {
  const { page: _page, [key]: _old, ...rest } = q;
  return value === null || (Array.isArray(value) && !value.length) || value === ''
    ? rest
    : { ...rest, [key]: value };
}

export const values = (q: SearchQuery, key: string): string[] => [q[key] ?? []].flat();
