import type { LucideIcon } from "lucide-react";

/** Etichetta con icona per le voci delle select: compare sia nel menu sia nel trigger. */
export function IconLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <>
      <Icon className="text-muted-foreground" />
      {children}
    </>
  );
}
