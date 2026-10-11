import { InfoTip } from '@/components/InfoTip';
import { Card } from '@/components/ui/card';

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  /** A short second line, such as a range or a count. */
  detail?: string;
  tip: string;
}

/** One headline number with its unit, an optional detail line and an explanation. */
export function MetricCard({ label, value, unit, detail, tip }: MetricCardProps) {
  return (
    <Card className="p-4">
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>{label}</span>
        <InfoTip label={`About ${label.toLowerCase()}`}>{tip}</InfoTip>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {value}
        {unit && <span className="text-muted-foreground ml-1 text-sm font-normal">{unit}</span>}
      </p>
      {detail && <p className="text-muted-foreground mt-0.5 text-xs">{detail}</p>}
    </Card>
  );
}
