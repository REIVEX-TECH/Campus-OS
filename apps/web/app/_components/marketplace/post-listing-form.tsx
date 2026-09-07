'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { parsePkrToPaisa } from '@/lib/money';

export interface ListingFormLabels {
  title: string;
  titlePlaceholder: string;
  description: string;
  price: string;
  pricePlaceholder: string;
  priceKind: string;
  fixed: string;
  negotiable: string;
  category: string;
  condition: string;
  meetup: string;
  meetupPlaceholder: string;
  photos: string;
  photosHint: string;
  optional: string;
  submit: string;
  submitting: string;
  failed: string;
  tooLarge: string;
  badType: string;
  contactInfo: string;
  prohibitedTitle: string;
  prohibitedBody: string;
  categoryLabels: Record<string, string>;
  conditionLabels: Record<string, string>;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const CONDITIONS = ['new', 'like-new', 'used', 'for-parts'] as const;

const field =
  'ios-field h-11 w-full rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const area =
  'ios-field min-h-24 w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Post a goods listing: text fields, then upload each photo to the created listing. */
export function PostListingForm({
  base,
  tenant,
  categories,
  maxPhotos,
  maxUploadBytes,
  labels,
}: {
  base: string;
  tenant: string;
  categories: string[];
  maxPhotos: number;
  maxUploadBytes: number;
  labels: ListingFormLabels;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [priceKind, setPriceKind] = useState<'fixed' | 'negotiable'>('fixed');
  const [category, setCategory] = useState(categories[0] ?? 'other');
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]>('used');
  const [meetup, setMeetup] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  function onPick(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list).slice(0, maxPhotos);
    for (const f of picked) {
      if (!ACCEPTED.includes(f.type)) return setError(labels.badType);
      if (f.size > maxUploadBytes) return setError(labels.tooLarge);
    }
    setError(null);
    setFiles(picked);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'saving') return;
    const pricePaisa = parsePkrToPaisa(price);
    if (pricePaisa === null) {
      setError(labels.failed);
      return;
    }
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/marketplace/listings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant,
          title,
          description: description || undefined,
          pricePaisa,
          priceKind,
          category,
          condition,
          meetupPref: meetup || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus('error');
        setError(body.error === 'contact_info' ? labels.contactInfo : labels.failed);
        return;
      }
      const { id } = (await res.json()) as { id: string };
      for (const file of files) {
        const body = new FormData();
        body.set('tenant', tenant);
        body.set('file', file);
        // A failed photo does not lose the listing; continue.
        await fetch(`/api/marketplace/listings/${id}/photos`, { method: 'POST', body });
      }
      router.push(`${base}/marketplace/${id}`);
    } catch {
      setStatus('error');
      setError(labels.failed);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{labels.title}</span>
        <input
          className={field}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={labels.titlePlaceholder}
          maxLength={140}
          required
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{labels.description}</span>
        <textarea
          className={area}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          rows={4}
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium">{labels.price}</span>
          <input
            className={field}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={labels.pricePlaceholder}
            inputMode="decimal"
            required
          />
        </label>
        <label className="flex w-40 flex-col gap-1">
          <span className="text-sm font-medium">{labels.priceKind}</span>
          <select
            className={field}
            value={priceKind}
            onChange={(e) => setPriceKind(e.target.value as 'fixed' | 'negotiable')}
          >
            <option value="fixed">{labels.fixed}</option>
            <option value="negotiable">{labels.negotiable}</option>
          </select>
        </label>
      </div>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium">{labels.category}</span>
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {labels.categoryLabels[c] ?? c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium">{labels.condition}</span>
          <select
            className={field}
            value={condition}
            onChange={(e) => setCondition(e.target.value as (typeof CONDITIONS)[number])}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {labels.conditionLabels[c] ?? c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {labels.meetup} <span className="text-muted-foreground">({labels.optional})</span>
        </span>
        <input
          className={field}
          value={meetup}
          onChange={(e) => setMeetup(e.target.value)}
          placeholder={labels.meetupPlaceholder}
          maxLength={120}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{labels.photos}</span>
        <input
          type="file"
          accept={ACCEPTED.join(',')}
          multiple
          onChange={(e) => onPick(e.target.files)}
          className="text-sm"
        />
        <span className="text-xs text-muted-foreground">
          {labels.photosHint.replace('{max}', String(maxPhotos))}
        </span>
        {files.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
            {files.map((f) => (
              <li key={f.name}>{f.name}</li>
            ))}
          </ul>
        ) : null}
      </label>

      <div className="ios-card flex flex-col gap-1 rounded-2xl p-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{labels.prohibitedTitle}</span>
        <span>{labels.prohibitedBody}</span>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div>
        <button
          type="submit"
          disabled={status === 'saving' || title.trim().length < 3 || price.trim() === ''}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {status === 'saving' ? labels.submitting : labels.submit}
        </button>
      </div>
    </form>
  );
}
