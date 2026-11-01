'use client';
import type { SearchSuggestion } from '@accordo/shared';
import { Button, cn, Input } from '@accordo/ui';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';

/** Search bar with ARIA 1.2 combobox suggestions (brands, categories, titles; SPEC §9.3). */
export function SearchBox({
  className,
  initial = '',
  size = 'md',
}: {
  className?: string;
  initial?: string;
  size?: 'md' | 'lg';
}) {
  const t = useTranslations('Search');
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const h = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(h);
  }, [text]);

  const { data: options = [] } = useQuery({
    queryKey: ['suggest', query],
    queryFn: () =>
      api.get<SearchSuggestion[]>(`/api/v1/search/suggest?q=${encodeURIComponent(query)}`),
    enabled: open && query.length >= 2,
    staleTime: 60_000,
  });
  const shown = open && query.length >= 2 && options.length > 0;

  function go(path: string) {
    setOpen(false);
    router.push(path);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const option = shown ? options[active] : undefined;
    if (option) return go(option.path);
    go(text.trim() ? `/annunci?q=${encodeURIComponent(text.trim())}` : '/annunci');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <search className={cn('relative block', className)}>
      <form onSubmit={submit} className="flex">
        <label htmlFor={id} className="sr-only">
          {t('searchLabel')}
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={listId}
          aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={t('placeholder')}
          value={text}
          maxLength={120}
          className={cn('pl-9', size === 'lg' && 'h-11 rounded-r-none border-r-0 text-base')}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        {size === 'lg' ? (
          <Button type="submit" className="h-11 rounded-l-none px-5">
            {t('submit')}
          </Button>
        ) : null}
        {shown ? (
          <div
            id={listId}
            role="listbox"
            aria-label={t('suggestions')}
            className="absolute top-full left-0 z-30 mt-1 w-full overflow-hidden rounded-md border bg-popover p-1 shadow-md"
          >
            {options.map((o, i) => (
              <div
                key={o.path}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                className={cn(
                  'flex cursor-pointer justify-between gap-2 rounded px-3 py-2 text-sm',
                  i === active && 'bg-accent',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(o.path)}
                onKeyDown={() => undefined}
              >
                <span className="truncate">{o.label}</span>
                <span className="text-xs text-muted-foreground">{t(`kind.${o.kind}`)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </form>
    </search>
  );
}
