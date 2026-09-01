import * as React from 'react';
import { cn } from '../lib/utils';

// iOS filled field: a flat light-grey fill (not a neumorphic inset), rounded,
// with a clear focus ring. Text sits on the solid fill so contrast holds.
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = 'text', ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'ios-field flex h-11 w-full rounded-xl px-3.5 text-[17px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
