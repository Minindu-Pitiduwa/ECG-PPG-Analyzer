import { Activity, FolderOpen, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRecordingStore } from '@/store/recording';
import { useThemeStore } from '@/store/theme';

const REPO_URL = 'https://github.com/Minindu-Pitiduwa/ECG-PPG-Analyzer';

/** lucide-react ships no brand icons, so the GitHub mark is inlined. */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function TopBar() {
  const setStep = useRecordingStore((state) => state.setStep);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggle);

  return (
    <header className="bg-card border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Activity className="text-signal size-5" aria-hidden />
        <span className="text-base font-semibold tracking-tight">PulseScope</span>
        <span className="text-muted-foreground hidden text-sm sm:inline">
          ECG &amp; PPG analyzer
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button onClick={() => setStep('load')}>
            <FolderOpen aria-hidden />
            Load data
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
          </Button>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Source code on GitHub"
            className="hover:bg-muted inline-flex size-9 items-center justify-center rounded-md"
          >
            <GitHubMark />
          </a>
        </div>
      </div>
    </header>
  );
}
