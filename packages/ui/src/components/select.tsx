import * as React from 'react';
import { cn } from '../lib/utils';

// iOS filled select: a flat light-grey field, rounded, clear focus ring. Native
// <select> keeps it accessible and zero-JS; the picker wires the onChange.
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'ios-field flex h-11 w-full rounded-xl px-3.5 text-[17px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';
