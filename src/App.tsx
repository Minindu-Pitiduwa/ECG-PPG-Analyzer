import { Tooltip } from 'radix-ui';
import { Disclaimer } from '@/components/Disclaimer';
import { Stepper } from '@/components/Stepper';
import { TopBar } from '@/components/TopBar';
import { AnalyzeView } from '@/features/analyze/AnalyzeView';
import { LoadView } from '@/features/load/LoadView';
import { ReportView } from '@/features/report/ReportView';
import { useRecordingStore } from '@/store/recording';

export function App() {
  const step = useRecordingStore((state) => state.step);
  const recording = useRecordingStore((state) => state.recording);

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="flex min-h-screen flex-col">
        <TopBar />
        <Stepper />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          {step === 'load' && <LoadView />}
          {step === 'analyze' && recording && <AnalyzeView recording={recording} />}
          {step === 'report' && <ReportView />}
        </main>
        <Disclaimer />
      </div>
    </Tooltip.Provider>
  );
}
