'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { parsePkrToPaisa } from '@/lib/money';

const TIERS = ['basic', 'standard', 'premium'] as const;
type Tier = (typeof TIERS)[number];

export interface GigFormLabels {
  title: string;
  titlePlaceholder: string;
  description: string;
  category: string;
  photos: string;
  photosHint: string;
  optional: string;
  packages: string;
  packagesHint: string;
  pkgTitle: string;
  pkgPrice: string;
  pkgDelivery: string;
  pkgRevisions: string;
  pkgDescription: string;
  submit: string;
  submitting: string;
  failed: string;
  tooLarge: string;
  badType: string;
  contactInfo: string;
  prohibitedTitle: string;
  prohibitedBody: string;
  categoryLabels: Record<string, string>;
  tierLabels: Record<Tier, string>;
}

interface PackageState {
  on: boolean;
  title: string;
  price: string;
  deliveryDays: string;
  revisions: string;
  description: string;
}

const emptyPackage = (): PackageState => ({
  on: false,
  title: '',
  price: '',
  deliveryDays: '3',
  revisions: '1',
  description: '',
});

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const field =
  'ios-field h-11 w-full rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const area =
  'ios-field min-h-20 w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Create a gig: title/description/category, one to three packages, portfolio photos. */
export function PostGigForm({
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
  labels: GigFormLabels;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'other');
  const [packages, setPackages] = useState<Record<Tier, PackageState>>({
    basic: { ...emptyPackage(), on: true },
    standard: emptyPackage(),
    premium: emptyPackage(),
  });
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  function setPkg(tier: Tier, patch: Partial<PackageState>) {
    setPackages((prev) => ({ ...prev, [tier]: { ...prev[tier], ...patch } }));
  }

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
    const chosen: {
      tier: Tier;
      title: string;
      description?: string;
      pricePaisa: number;
      deliveryDays: number;
      revisions: number;
    }[] = [];
    for (const tier of TIERS) {
      const p = packages[tier];
      if (!p.on) continue;
      const pricePaisa = parsePkrToPaisa(p.price);
      const deliveryDays = Number.parseInt(p.deliveryDays, 10);
      const revisions = Number.parseInt(p.revisions, 10);
      if (pricePaisa === null || pricePaisa <= 0 || !Number.isFinite(deliveryDays)) {
        setError(labels.failed);
        return;
      }
      chosen.push({
        tier,
        title: p.title,
        description: p.description || undefined,
        pricePaisa,
        deliveryDays,
        revisions: Number.isFinite(revisions) ? revisions : 0,
      });
    }
    if (chosen.length === 0) {
      setError(labels.failed);
      return;
    }
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/marketplace/gigs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant,
          title,
          description: description || undefined,
          category,
          packages: chosen,
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
        await fetch(`/api/marketplace/gigs/${id}/photos`, { method: 'POST', body });
      }
      router.push(`${base}/services/${id}`);
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
          maxLength={6000}
          rows={4}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{labels.category}</span>
        <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {labels.categoryLabels[c] ?? c}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">{labels.packages}</legend>
        <p className="text-xs text-muted-foreground">{labels.packagesHint}</p>
        {TIERS.map((tier) => {
          const p = packages[tier];
          const required = tier === 'basic';
          return (
            <div key={tier} className="ios-card flex flex-col gap-2 rounded-2xl p-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={p.on}
                  disabled={required}
                  onChange={(e) => setPkg(tier, { on: e.target.checked })}
                />
                {labels.tierLabels[tier]}
              </label>
              {p.on ? (
                <div className="flex flex-col gap-2">
                  <input
                    className={field}
                    value={p.title}
                    onChange={(e) => setPkg(tier, { title: e.target.value })}
                    placeholder={labels.pkgTitle}
                    maxLength={80}
                    required
                  />
                  <div className="flex gap-2">
                    <input
                      className={field}
                      value={p.price}
                      onChange={(e) => setPkg(tier, { price: e.target.value })}
                      placeholder={labels.pkgPrice}
                      inputMode="decimal"
                      required
                    />
                    <input
                      className={field}
                      value={p.deliveryDays}
                      onChange={(e) => setPkg(tier, { deliveryDays: e.target.value })}
                      placeholder={labels.pkgDelivery}
                      inputMode="numeric"
                      required
                    />
                    <input
                      className={field}
                      value={p.revisions}
                      onChange={(e) => setPkg(tier, { revisions: e.target.value })}
                      placeholder={labels.pkgRevisions}
                      inputMode="numeric"
                    />
                  </div>
                  <textarea
                    className={area}
                    value={p.description}
                    onChange={(e) => setPkg(tier, { description: e.target.value })}
                    placeholder={labels.pkgDescription}
                    maxLength={2000}
                    rows={2}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {labels.photos} <span className="text-muted-foreground">({labels.optional})</span>
        </span>
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
          disabled={status === 'saving' || title.trim().length < 5}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {status === 'saving' ? labels.submitting : labels.submit}
        </button>
      </div>
    </form>
  );
}
