import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The card shown when there is nothing to list. An optional icon makes the state
 * read as deliberate rather than as a card that failed to fill, and gives the eye
 * something to land on before the sentence. It is decorative: the title already
 * says what happened, so repeating it to a screen reader would only add noise.
 */
export function EmptyState({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  children?: ReactNode;
}) {
  return (
    <div className="ios-card flex flex-col items-center justify-center gap-2 rounded-2xl p-8 text-center sm:p-10">
      {Icon ? (
        <span
          className="grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
      ) : null}
      <p className="text-base font-medium">{title}</p>
      {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}
