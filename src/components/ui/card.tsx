import type { HTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/cn';

type CardProps = HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> };

export function Card({ className, ref, ...props }: CardProps) {
  return <div ref={ref} className={cn('bg-card rounded-lg border', className)} {...props} />;
}
