import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * `cn` — shadcn/ui convention. Composes class names with `clsx`
 * (handles conditionals, arrays, falsy filtering) and then runs
 * `tailwind-merge` to deduplicate conflicting Tailwind utilities
 * (e.g. `cn('px-4', condition && 'px-2')` → `'px-2'`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
