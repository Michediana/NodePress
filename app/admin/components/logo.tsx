import { cn } from "~/lib/utils";

// Stesso disegno di public/favicon.svg: una "N" fatta di nodi collegati.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="64" height="64" rx="14" fill="#18181b" />
      <path
        d="M20 44V20l24 24V20"
        fill="none"
        stroke="#fafafa"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="20" r="6" fill="#fafafa" />
      <circle cx="20" cy="44" r="6" fill="#fafafa" />
      <circle cx="44" cy="20" r="6" fill="#fafafa" />
      <circle cx="44" cy="44" r="6" fill="#22c55e" stroke="#18181b" strokeWidth="2" />
    </svg>
  );
}
