import { FileText } from 'lucide-react';
import { Card } from '@/components/ui/card';

export function ReportView() {
  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <FileText className="text-muted-foreground mx-auto size-8" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold">Report</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        PDF, CSV and JSON export will appear here once the analysis steps are in place.
      </p>
    </Card>
  );
}
