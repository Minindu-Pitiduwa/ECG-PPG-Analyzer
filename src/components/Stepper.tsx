import { cn } from '@/lib/cn';
import { useRecordingStore, type Step } from '@/store/recording';

const STEPS: { id: Step; label: string }[] = [
  { id: 'load', label: 'Load' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'report', label: 'Report' },
];

/** The three-step flow. Later steps unlock once a recording is loaded. */
export function Stepper() {
  const step = useRecordingStore((state) => state.step);
  const setStep = useRecordingStore((state) => state.setStep);
  const hasRecording = useRecordingStore((state) => state.recording !== null);

  return (
    <nav aria-label="Steps" className="bg-card border-b">
      <ol className="mx-auto flex max-w-6xl gap-1 px-4 sm:px-6">
        {STEPS.map(({ id, label }, index) => {
          const current = id === step;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => setStep(id)}
                disabled={id !== 'load' && !hasRecording}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm',
                  'disabled:cursor-not-allowed disabled:opacity-45',
                  current
                    ? 'border-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-xs',
                    current ? 'bg-primary text-primary-foreground' : 'bg-muted',
                  )}
                >
                  {index + 1}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
