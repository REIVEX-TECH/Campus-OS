import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

// A button is an interactive surface, so it gets the neumorphic affordance:
// gently raised at rest, pressed in on :active. Text sits on a solid token, so
// contrast is unaffected (see docs/design.md). Ghost and link stay flat.
const RAISED =
  'shadow-[var(--shadow-raised)] active:shadow-[var(--shadow-pressed)] active:translate-y-px';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[box-shadow,transform,background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: `bg-primary text-primary-foreground hover:bg-primary/90 ${RAISED}`,
        secondary: `bg-surface text-surface-foreground hover:brightness-[0.98] ${RAISED}`,
        outline: `bg-surface text-surface-foreground hover:brightness-[0.98] ${RAISED}`,
        destructive: `bg-destructive text-destructive-foreground hover:bg-destructive/90 ${RAISED}`,
        ghost: 'text-foreground hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

export { Button, buttonVariants };
