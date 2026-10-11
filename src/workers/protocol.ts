import type { AnalysisOptions, AnalysisResult } from '@/dsp/pipeline';
import type { SignalKind } from '@/dsp/types';
import type { CsvColumns, CsvExtractOptions } from '@/io/csv';

/** Every job the analysis worker can do, with its input and output. */
export interface WorkerApi {
  extractCsv: {
    params: { text: string; options: CsvExtractOptions };
    result: CsvColumns;
  };
  analyze: {
    params: { samples: Float64Array; fs: number; kind: SignalKind; options: AnalysisOptions };
    result: AnalysisResult;
  };
}

export type WorkerJob = keyof WorkerApi;

/** Each request carries an id so the client can match the reply to the promise waiting for it. */
export type WorkerRequest = {
  [Job in WorkerJob]: { id: number; job: Job; params: WorkerApi[Job]['params'] };
}[WorkerJob];

export type WorkerResponse =
  | { id: number; ok: true; result: WorkerApi[WorkerJob]['result'] }
  | { id: number; ok: false; message: string; isImportError: boolean };
