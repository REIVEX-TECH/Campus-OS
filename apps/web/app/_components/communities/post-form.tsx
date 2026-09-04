'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { postPath } from '@/lib/community-constants';

export type PostKind = 'text' | 'link' | 'poll';

export type PostFormLabels = {
  text: string;
  link: string;
  poll: string;
  title: string;
  body: string;
  url: string;
  /** "{n}" is replaced with the option's number. */
  pollOption: string;
  pollAddOption: string;
  /** "{n}" is replaced with the option's number. */
  pollRemoveOption: string;
  pollDuration: string;
  pollDurations: { day: string; threeDays: string; week: string };
  flair: string;
  noFlair: string;
  anonymous: string;
  anonymousHint: string;
  spoiler: string;
  submit: string;
  working: string;
  done: string;
  errors: Record<string, string>;
};

const DURATIONS = { day: 24, threeDays: 72, week: 168 } as const;
type Duration = keyof typeof DURATIONS;

const field =
  'ios-field h-11 w-full rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const area =
  'ios-field min-h-40 w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const tab = (active: boolean) =>
  `ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium ${
    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
  }`;

/**
 * Compose a post, or edit one. Text, a link or a poll on creation; edits
 * change the title and text only. The anonymous option says what it does,
 * every time.
 */
export function PostForm({
  tenant,
  base,
  communityId,
  communitySlug,
  mode,
  postId,
  allowedKinds,
  anonymousAllowed,
  flairs = [],
  initial,
  labels,
}: {
  tenant: string;
  base: string;
  communityId: string;
  communitySlug: string;
  mode: 'create' | 'edit';
  postId?: string;
  allowedKinds: PostKind[];
  anonymousAllowed: boolean;
  flairs?: { id: string; name: string }[];
  initial?: { title: string; body: string };
  labels: PostFormLabels;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<PostKind>(allowedKinds[0] ?? 'text');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [url, setUrl] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [duration, setDuration] = useState<Duration>('threeDays');
  const [flairId, setFlairId] = useState('');
  const [isAnonymous, setAnonymous] = useState(false);
  const [spoiler, setSpoiler] = useState(false);
  const [status, setStatus] = useState<{
    kind: 'idle' | 'working' | 'done' | 'error';
    message?: string;
  }>({
    kind: 'idle',
  });
  const working = status.kind === 'working';
  const kindLabel = (k: PostKind) =>
    k === 'text' ? labels.text : k === 'link' ? labels.link : labels.poll;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus({ kind: 'working' });
    const response =
      mode === 'create'
        ? await fetch(`/api/communities/${communityId}/posts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              tenant,
              kind,
              title,
              body: kind === 'link' ? undefined : body,
              url: kind === 'link' ? url : undefined,
              poll:
                kind === 'poll'
                  ? {
                      options: options.map((o) => o.trim()).filter(Boolean),
                      closesInHours: DURATIONS[duration],
                    }
                  : undefined,
              isAnonymous,
              spoiler,
              flairId: flairId || undefined,
            }),
          })
        : await fetch(`/api/communities/posts/${postId}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tenant, action: 'edit', title, body }),
          });
    const data = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
    if (!response.ok) {
      setStatus({
        kind: 'error',
        message: labels.errors[data.error ?? ''] ?? labels.errors.failed ?? '',
      });
      return;
    }
    setStatus({ kind: 'done', message: labels.done });
    router.refresh();
    router.push(
      postPath(base, communitySlug, mode === 'create' ? (data.id ?? '') : postId!, title),
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {mode === 'create' && allowedKinds.length > 1 ? (
        <div className="flex gap-1" role="tablist">
          {allowedKinds.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={tab(kind === k)}
            >
              {kindLabel(k)}
            </button>
          ))}
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.title}</span>
        <input
          className={field}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={300}
          autoComplete="off"
        />
      </label>

      {kind === 'link' && mode === 'create' ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{labels.url}</span>
          <input
            className={field}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            inputMode="url"
            autoComplete="off"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{labels.body}</span>
          <textarea
            className={area}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={40_000}
          />
        </label>
      )}

      {kind === 'poll' && mode === 'create' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{labels.poll}</legend>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={field}
                value={o}
                onChange={(e) =>
                  setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))
                }
                required
                maxLength={80}
                autoComplete="off"
                aria-label={labels.pollOption.replace('{n}', String(i + 1))}
                placeholder={labels.pollOption.replace('{n}', String(i + 1))}
              />
              {options.length > 2 ? (
                <button
                  type="button"
                  onClick={() => setOptions((all) => all.filter((_, j) => j !== i))}
                  aria-label={labels.pollRemoveOption.replace('{n}', String(i + 1))}
                  className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={options.length >= 6}
              onClick={() => setOptions((all) => [...all, ''])}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              {labels.pollAddOption}
            </button>
            <label className="flex items-center gap-2 text-sm">
              <span className="font-medium">{labels.pollDuration}</span>
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value as Duration)}
                className="ios-field h-9 rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(Object.keys(DURATIONS) as Duration[]).map((d) => (
                  <option key={d} value={d}>
                    {labels.pollDurations[d]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
      ) : null}

      {mode === 'create' && flairs.length > 0 ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{labels.flair}</span>
          <select
            value={flairId}
            onChange={(e) => setFlairId(e.target.value)}
            className="ios-field h-11 w-full rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{labels.noFlair}</option>
            {flairs.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {mode === 'create' ? (
        <div className="flex flex-col gap-2">
          {anonymousAllowed ? (
            <label className="flex flex-col gap-1">
              <span className="flex min-h-10 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={isAnonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                {labels.anonymous}
              </span>
              <span className="pl-6 text-xs text-muted-foreground">{labels.anonymousHint}</span>
            </label>
          ) : null}
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={spoiler}
              onChange={(e) => setSpoiler(e.target.checked)}
            />
            {labels.spoiler}
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={working}
          aria-busy={working || undefined}
          className={buttonVariants()}
        >
          {working ? labels.working : labels.submit}
        </button>
        {status.kind === 'done' || status.kind === 'error' ? (
          <p
            role="status"
            className={
              status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
            }
          >
            {status.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
