import { cn } from '@/lib/utils'
import { HTMLAttributes } from 'react'

export function Card({ className, style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-xl border p-6 shadow-sm', className)}
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', ...style }}
      {...props}
    />
  )
}
