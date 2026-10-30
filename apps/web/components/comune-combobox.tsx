'use client';
import type { ComuneOption } from '@accordo/shared';
import { cn, Input } from '@accordo/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';

export interface ComuneValue {
  id: string;
  name: string;
  provinciaSigla: string;
}

const label = (c: ComuneValue) => `${c.name} (${c.provinciaSigla})`;

/** ARIA 1.2 combobox with listbox popup; debounced search on /geo/comuni. */
export function ComuneCombobox({
  value,
  onChange,
  id,
  ...aria
}: {
  value: ComuneValue | null;
  onChange: (v: ComuneValue | null) => void;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('Settings.profile');
  const listId = useId();
  const [text, setText] = useState(value ? label(value) : '');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const h = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(h);
  }, [text]);
  useEffect(() => setText(value ? label(value) : ''), [value]);

  const { data: options = [] } = useQuery({
    queryKey: ['comuni', query],
    queryFn: () => api.get<ComuneOption[]>(`/api/v1/geo/comuni?q=${encodeURIComponent(query)}`),
    enabled: open && query.length >= 2 && (!value || query !== label(value)),
  });

  function select(o: ComuneOption) {
    onChange({ id: o.id, name: o.name, provinciaSigla: o.provinciaSigla });
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault();
      select(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={t('comunePlaceholder')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        {...aria}
      />
      {open && query.length >= 2 ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">{t('noResults')}</div>
          ) : (
            options.map((o, i) => (
              <div
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  'cursor-pointer rounded px-3 py-2 text-sm',
                  i === active && 'bg-accent',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(o)}
                tabIndex={-1}
                onKeyDown={() => undefined}
              >
                {label(o)}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
