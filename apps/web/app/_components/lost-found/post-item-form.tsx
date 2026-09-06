'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface LostFoundFormLabels {
  kind: string;
  lost: string;
  found: string;
  title: string;
  titlePlaceholder: string;
  description: string;
  category: string;
  location: string;
  locationPlaceholder: string;
  building: string;
  buildingNone: string;
  date: string;
  optional: string;
  photos: string;
  photosHint: string;
  submit: string;
  submitting: string;
  failed: string;
  tooLarge: string;
  badType: string;
  categoryLabels: Record<string, string>;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

/** Report an item: text fields, then upload each photo to the created item. */
export function PostItemForm({
  base,
  tenant,
  categories,
  buildings,
  maxPhotos,
  maxUploadBytes,
  labels,
}: {
  base: string;
  tenant: string;
  categories: string[];
  buildings: { id: string; name: string }[];
  maxPhotos: number;
  maxUploadBytes: number;
  labels: LostFoundFormLabels;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<'lost' | 'found'>('lost');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'other');
  const [location, setLocation] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [happenedOn, setHappenedOn] = useState('');
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
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/lost-found/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant,
          kind,
          title,
          description: description || undefined,
          category,
          locationText: location || undefined,
          buildingId: buildingId || undefined,
          happenedOn: happenedOn || undefined,
        }),
      });
      if (!res.ok) throw new Error('create');
      const { id } = (await res.json()) as { id: string };
      for (const file of files) {
        const body = new FormData();
        body.set('tenant', tenant);
        body.set('file', file);
        // A failed photo does not lose the item; report it but continue.
        await fetch(`/api/lost-found/items/${id}/photos`, { method: 'POST', body });
      }
      router.push(`${base}/lost-found/${id}`);
    } catch {
      setStatus('error');
      setError(labels.failed);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="flex gap-2" aria-label={labels.kind}>
        {(['lost', 'found'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              kind === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {k === 'lost' ? labels.lost : labels.found}
          </button>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{labels.title}</span>
        <input
          className="ios-field"
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
          className="ios-field min-h-24"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          rows={4}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{labels.category}</span>
        <select
          className="ios-field"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {labels.categoryLabels[c] ?? c}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {labels.location} <span className="text-muted-foreground">({labels.optional})</span>
        </span>
        <input
          className="ios-field"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={labels.locationPlaceholder}
          maxLength={200}
        />
      </label>

      {buildings.length > 0 ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            {labels.building} <span className="text-muted-foreground">({labels.optional})</span>
          </span>
          <select
            className="ios-field"
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
          >
            <option value="">{labels.buildingNone}</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {labels.date} <span className="text-muted-foreground">({labels.optional})</span>
        </span>
        <input
          className="ios-field"
          type="date"
          value={happenedOn}
          onChange={(e) => setHappenedOn(e.target.value)}
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

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div>
        <button
          type="submit"
          disabled={status === 'saving' || title.trim().length < 3}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {status === 'saving' ? labels.submitting : labels.submit}
        </button>
      </div>
    </form>
  );
}
