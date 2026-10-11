import { ShieldAlert } from 'lucide-react';
import { DISCLAIMER } from '@/lib/appInfo';

/** Shown on every screen: this tool must never be mistaken for a diagnostic device. */
export function Disclaimer() {
  return (
    <footer className="bg-card border-t">
      <p className="text-muted-foreground mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 text-xs sm:px-6">
        <ShieldAlert className="size-4 shrink-0" aria-hidden />
        {DISCLAIMER}
      </p>
    </footer>
  );
}
