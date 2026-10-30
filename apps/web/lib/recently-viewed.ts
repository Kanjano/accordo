import type { ListingCardItem } from '@accordo/shared';

const KEY = 'accordo:recently-viewed';
const MAX = 20;

/** Anonymous history in localStorage (SPEC §3.4); merged into the account at login. */
export function readRecent(): ListingCardItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as ListingCardItem[]) : [];
  } catch {
    return [];
  }
}

export function pushRecent(item: ListingCardItem): void {
  try {
    const rest = readRecent().filter((i) => i.id !== item.id);
    localStorage.setItem(KEY, JSON.stringify([item, ...rest].slice(0, MAX)));
  } catch {
    // storage unavailable (private mode, blocked): history is a convenience only
  }
}
