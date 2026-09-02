'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Select } from '@campusos/ui';

export type ComboOption = { id: string; label: string };

/**
 * An accessible searchable dropdown (WAI-ARIA editable combobox): type to filter,
 * ArrowUp/Down to move, Enter to pick, Escape to close. Before hydration (and
 * with JS disabled) it renders the native <select> below, then enhances to the
 * combobox on mount, so there is always a keyboard-usable control. The popup
 * listbox scrolls when long (a transient popup, like a native select's menu),
 * which is separate from the app's no-inner-scroll layout rule.
 */
export function Combobox({
  id,
  value,
  options,
  onSelect,
  placeholder,
  ariaLabel,
}: {
  id: string;
  value?: string;
  options: ComboOption[];
  onSelect: (id: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [enhanced, setEnhanced] = useState(false);
  useEffect(() => setEnhanced(true), []);

  if (!enhanced) {
    return (
      <Select
        id={id}
        aria-label={ariaLabel}
        value={value ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <ComboboxLive
      id={id}
      value={value}
      options={options}
      onSelect={onSelect}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
    />
  );
}

function ComboboxLive({
  id,
  value,
  options,
  onSelect,
  placeholder,
  ariaLabel,
}: {
  id: string;
  value?: string;
  options: ComboOption[];
  onSelect: (id: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [query, options]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(o: ComboOption): void {
    onSelect(o.id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
      } else {
        setActive((i) => Math.min(i + 1, filtered.length - 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault();
        choose(filtered[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  const display = open ? query : (selected?.label ?? '');

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={open && filtered[active] ? `${listId}-opt-${active}` : undefined}
        autoComplete="off"
        value={display}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="ios-field h-11 w-full rounded-xl px-3.5 text-[17px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="ios-card absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl p-1"
        >
          {filtered.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={o.id === value}
              data-value={o.id}
              data-active={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-[15px] ${
                i === active ? 'bg-muted text-foreground' : 'text-foreground'
              }`}
            >
              {o.label}
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{placeholder}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
