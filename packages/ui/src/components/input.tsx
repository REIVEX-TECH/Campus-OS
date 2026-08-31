import * as React from 'react';
import { cn } from '../lib/utils';

// Inputs are interactive surfaces: recessed (neumorphic inset). Text is the
// solid --surface-foreground, so contrast holds (see docs/design.md).
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = 'text', ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'neu-inset flex h-10 w-full rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
