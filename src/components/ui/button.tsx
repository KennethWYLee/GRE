import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-colors outline-none disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#1d684e]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f0e8]',
  {
    variants: {
      variant: {
        default: 'border border-[#17231d] bg-[#17231d] text-[#fffdf8] hover:bg-[#1d684e]',
        outline: 'border border-[#17231d] bg-transparent text-[#17231d] hover:bg-[#e7e4dc]',
        ghost: 'bg-transparent text-[#17231d] hover:bg-[#e7e4dc]',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-9 px-3',
        lg: 'h-12 px-5',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

function Button({ className, variant, size, asChild = false, ...props }:
  React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size, className }))} data-slot="button" {...props} />
}

export { Button }
