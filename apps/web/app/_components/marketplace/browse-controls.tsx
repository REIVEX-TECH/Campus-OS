'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface BrowseControlLabels {
  searchPlaceholder: string;
  sort: string;
  sortNew: string;
  sortPriceAsc: string;
  sortPriceDesc: string;
  allCategories: string;
  allConditions: string;
  priceMin: string;
  priceMax: string;
  apply: string;
  clear: string;
  categoryLabels: Record<string, string>;
  conditionLabels: Record<string, string>;
}

const CONDITIONS = ['new', 'like-new', 'used', 'for-parts'] as const;

const field =
  'ios-field h-10 rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Browse filters, sort and search. Submitting builds the URL query the server
 *  page reads; the page re-renders from the new params (a real navigation, so
 *  deep links and the back button work). */
export function BrowseControls({
  base,
  categories,
  initial,
  labels,
}: {
  base: string;
  categories: string[];
  initial: {
    q: string;
    category: string;
    condition: string;
    min: string;
    max: string;
    sort: string;
  };
  labels: BrowseControlLabels;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [category, setCategory] = useState(initial.category);
  const [condition, setCondition] = useState(initial.condition);
  const [min, setMin] = useState(initial.min);
  const [max, setMax] = useState(initial.max);
  const [sort, setSort] = useState(initial.sort || 'new');

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (category) params.set('category', category);
    if (condition) params.set('condition', condition);
    if (min.trim()) params.set('min', min.trim());
    if (max.trim()) params.set('max', max.trim());
    if (sort && sort !== 'new') params.set('sort', sort);
    const query = params.toString();
    router.push(query ? `${base}/marketplace?${query}` : `${base}/marketplace`);
  }

  function clear() {
    setQ('');
    setCategory('');
    setCondition('');
    setMin('');
    setMax('');
    setSort('new');
    router.push(`${base}/marketplace`);
  }

  return (
    <form onSubmit={apply} className="ios-card flex flex-col gap-3 rounded-2xl p-3">
      <input
        className={`${field} w-full`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.searchPlaceholder}
        type="search"
      />
      <div className="flex flex-wrap gap-2">
        <select
          className={field}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label={labels.allCategories}
        >
          <option value="">{labels.allCategories}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {labels.categoryLabels[c] ?? c}
            </option>
          ))}
        </select>
        <select
          className={field}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          aria-label={labels.allConditions}
        >
          <option value="">{labels.allConditions}</option>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {labels.conditionLabels[c] ?? c}
            </option>
          ))}
        </select>
        <input
          className={`${field} w-28`}
          value={min}
          onChange={(e) => setMin(e.target.value)}
          placeholder={labels.priceMin}
          aria-label={labels.priceMin}
          inputMode="numeric"
        />
        <input
          className={`${field} w-28`}
          value={max}
          onChange={(e) => setMax(e.target.value)}
          placeholder={labels.priceMax}
          aria-label={labels.priceMax}
          inputMode="numeric"
        />
        <select
          className={field}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label={labels.sort}
        >
          <option value="new">{labels.sortNew}</option>
          <option value="price_asc">{labels.sortPriceAsc}</option>
          <option value="price_desc">{labels.sortPriceDesc}</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="ios-pressable rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
        >
          {labels.apply}
        </button>
        <button
          type="button"
          onClick={clear}
          className="ios-pressable rounded-xl px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          {labels.clear}
        </button>
      </div>
    </form>
  );
}
