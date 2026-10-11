/// <reference lib="webworker" />
import { runNoiseExperiment } from '@/dsp/noise/experiment';
import { analyzeRecording } from '@/dsp/pipeline';
import { extractCsvColumns } from '@/io/csv';
import { ImportError } from '@/io/types';
import type { WorkerApi, WorkerJob, WorkerRequest, WorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

interface JobOutput<Job extends WorkerJob> {
  result: WorkerApi[Job]['result'];
  /** Buffers to hand over to the main thread instead of copying them. */
  transfer: ArrayBufferLike[];
}

const handlers: { [Job in WorkerJob]: (params: WorkerApi[Job]['params']) => JobOutput<Job> } = {
  extractCsv: ({ text, options }) => {
    const result = extractCsvColumns(text, options);
    return {
      result,
      transfer: [result.signal.buffer, ...(result.time ? [result.time.buffer] : [])],
    };
  },
  analyze: ({ samples, fs, kind, options }) => {
    const result = analyzeRecording(samples, fs, kind, options);
    return {
      result,
      transfer: [result.filtered.buffer, result.peaks.buffer, result.beatTimesS.buffer],
    };
  },
  noiseExperiment: (params) => {
    const result = runNoiseExperiment(
      params.samples,
      params.fs,
      params.kind,
      params.options,
      params.referenceBeatsS,
      params.noiseKind,
      params.noiseOptions,
      params.snrLevelsDb,
      params.previewSnrDb,
    );
    const { noisy, filtered, beatTimesS } = result.preview;
    return { result, transfer: [noisy.buffer, filtered.buffer, beatTimesS.buffer] };
  },
};

function run(request: WorkerRequest): JobOutput<WorkerJob> {
  // The switch lets TypeScript pair each job name with its own parameter type.
  switch (request.job) {
    case 'extractCsv':
      return handlers.extractCsv(request.params);
    case 'analyze':
      return handlers.analyze(request.params);
    case 'noiseExperiment':
      return handlers.noiseExperiment(request.params);
  }
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  let response: WorkerResponse;
  let transfer: ArrayBufferLike[] = [];
  try {
    const output = run(request);
    response = { id: request.id, ok: true, result: output.result };
    transfer = output.transfer;
  } catch (error) {
    response = {
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      isImportError: error instanceof ImportError,
    };
  }
  scope.postMessage(response, transfer as Transferable[]);
};
