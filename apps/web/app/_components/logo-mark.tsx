import Image from 'next/image';

/**
 * The CampusOS logo mark for in-app use, theme-aware: the filled teal disc reads
 * on light surfaces, the teal mark reads on dark ones. Both are rendered and CSS
 * shows the right one for the current theme (the theme class is set on <html>
 * before first paint, so there is no swap flash). Always decorative: every place
 * it appears sits beside a text brand or a link that already carries the
 * accessible name, so it is `alt=""` and hidden from assistive tech. Sized in
 * pixels so it never shifts layout.
 */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  const cls = (variant: string): string => [variant, className].filter(Boolean).join(' ');
  return (
    <>
      <Image
        src="/logo-mark-light.png"
        width={size}
        height={size}
        alt=""
        className={cls('block dark:hidden')}
      />
      <Image
        src="/logo-mark.png"
        width={size}
        height={size}
        alt=""
        className={cls('hidden dark:block')}
      />
    </>
  );
}
