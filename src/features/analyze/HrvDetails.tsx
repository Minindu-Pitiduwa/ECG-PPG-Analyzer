import { useId } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Select } from '@/components/ui/field';
import { GLOSSARY } from '@/content/glossary';
import type { SpectralMethod } from '@/dsp/hrv/frequencyDomain';
import type { SignalKind } from '@/dsp/types';
import { useSettingsStore } from '@/store/settings';
import { PoincarePlot } from './PoincarePlot';
import { PsdPlot } from './PsdPlot';
import type { Analysis } from './useAnalysis';

const formatMs = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '–');
const formatPower = (value: number) =>
  Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '–';
const formatRatio = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : '–');

interface RowProps {
  label: string;
  value: string;
  unit: string;
  tip: string;
}

function Row({ label, value, unit, tip }: RowProps) {
  return (
    <tr className="border-t first:border-t-0">
      <th scope="row" className="py-1.5 pr-2 text-left font-normal">
        <span className="flex items-center gap-1">
          {label}
          <InfoTip label={`About ${label}`}>{tip}</InfoTip>
        </span>
      </th>
      <td className="py-1.5 text-right font-medium tabular-nums">{value}</td>
      <td className="text-muted-foreground w-12 py-1.5 pl-1.5 text-xs">{unit}</td>
    </tr>
  );
}

function Section({
  title,
  tip,
  children,
}: {
  title: string;
  tip: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <InfoTip label={`About ${title.toLowerCase()}`}>{tip}</InfoTip>
      </div>
      {children}
    </section>
  );
}

interface HrvDetailsProps {
  analysis: Analysis;
  kind: SignalKind;
}

export function HrvDetails({ analysis, kind }: HrvDetailsProps) {
  const id = useId();
  const method = useSettingsStore((state) => state.spectralMethod);
  const setMethod = useSettingsStore((state) => state.setSpectralMethod);
  const { timeDomain, spectral, poincare, exclusions } = analysis;

  if (timeDomain.count < 2) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        Variability needs at least a few normal beat-to-beat intervals, and none were found.
      </p>
    );
  }

  const excludedParts = [
    exclusions.short && `${exclusions.short} too short`,
    exclusions.long && `${exclusions.long} too long`,
    exclusions.implausible && `${exclusions.implausible} implausible`,
    exclusions.lowQuality && `${exclusions.lowQuality} in low-quality signal`,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Based on {timeDomain.count.toLocaleString('en-US')} normal intervals.{' '}
        {exclusions.excluded === 0
          ? 'No intervals were excluded.'
          : `${exclusions.excluded} of ${exclusions.total} intervals (${((100 * exclusions.excluded) / exclusions.total).toFixed(1)}%) were excluded: ${excludedParts.join(', ')}.`}
        {kind === 'ppg' &&
          ' These values come from pulse intervals (pulse rate variability). At rest they track heart rate variability closely, but they are not identical to it.'}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <Section
          title="Time domain"
          tip="Statistics of the normal beat-to-beat intervals themselves."
        >
          <table className="w-full text-sm">
            <tbody>
              <Row
                label="Mean NN"
                value={formatMs(timeDomain.meanNN)}
                unit="ms"
                tip={GLOSSARY.meanNN}
              />
              <Row label="SDNN" value={formatMs(timeDomain.sdnn)} unit="ms" tip={GLOSSARY.sdnn} />
              <Row
                label="RMSSD"
                value={formatMs(timeDomain.rmssd)}
                unit="ms"
                tip={GLOSSARY.rmssd}
              />
              <Row label="pNN50" value={formatMs(timeDomain.pnn50)} unit="%" tip={GLOSSARY.pnn50} />
            </tbody>
          </table>
        </Section>

        <Section title="Poincaré plot" tip={GLOSSARY.poincare}>
          <div className="flex flex-wrap items-start gap-4">
            <PoincarePlot data={poincare} />
            <table className="min-w-40 flex-1 text-sm">
              <tbody>
                <Row label="SD1" value={formatMs(poincare.sd1)} unit="ms" tip={GLOSSARY.sd1} />
                <Row label="SD2" value={formatMs(poincare.sd2)} unit="ms" tip={GLOSSARY.sd2} />
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <Section title="Frequency domain" tip={GLOSSARY.spectrum}>
        {spectral.available ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
            <PsdPlot psd={spectral.psd} showVlf={spectral.vlfAvailable} />
            <div className="space-y-3">
              <table className="w-full text-sm">
                <tbody>
                  {spectral.vlfAvailable && (
                    <Row
                      label="VLF power"
                      value={formatPower(spectral.bands.vlf)}
                      unit="ms²"
                      tip={GLOSSARY.vlf}
                    />
                  )}
                  <Row
                    label="LF power"
                    value={formatPower(spectral.bands.lf)}
                    unit="ms²"
                    tip={GLOSSARY.lf}
                  />
                  <Row
                    label="HF power"
                    value={formatPower(spectral.bands.hf)}
                    unit="ms²"
                    tip={GLOSSARY.hf}
                  />
                  <Row
                    label="LF/HF"
                    value={formatRatio(spectral.bands.lfHfRatio)}
                    unit=""
                    tip={GLOSSARY.lfHf}
                  />
                </tbody>
              </table>
              {!spectral.vlfAvailable && (
                <p className="text-muted-foreground text-xs">
                  VLF power is hidden: it needs at least 5 minutes of usable beats, and this
                  recording has {(spectral.usableS / 60).toFixed(1)}.
                </p>
              )}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <label htmlFor={`${id}-method`} className="text-sm font-medium">
                    Method
                  </label>
                  <InfoTip label="About the spectral method">{GLOSSARY.spectralMethod}</InfoTip>
                </div>
                <Select
                  id={`${id}-method`}
                  value={method}
                  onChange={(event) => setMethod(event.target.value as SpectralMethod)}
                >
                  <option value="lombScargle">Lomb–Scargle</option>
                  <option value="welch">Welch (4 Hz resampling)</option>
                </Select>
              </div>
            </div>
          </div>
        ) : (
          <p className="bg-muted rounded-md p-3 text-sm">{spectral.reason}</p>
        )}
      </Section>
    </div>
  );
}
