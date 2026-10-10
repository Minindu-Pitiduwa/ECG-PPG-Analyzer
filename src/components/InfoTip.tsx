import { Info } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import { useState } from 'react';

interface InfoTipProps {
  /** What the tip is about, for screen readers: "About sampling rate". */
  label: string;
  children: string;
}

/** A small info icon that explains a metric or setting in plain language. */
export function InfoTip({ label, children }: InfoTipProps) {
  // Controlled so a tap opens it too; hover-only tooltips are unreachable on touch screens.
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={() => setOpen(true)}
          className="text-muted-foreground hover:text-foreground inline-flex size-5 items-center justify-center rounded-full"
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          collisionPadding={12}
          className="bg-foreground text-background z-50 max-w-72 rounded-md px-3 py-2 text-xs leading-relaxed shadow-lg"
        >
          {children}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
