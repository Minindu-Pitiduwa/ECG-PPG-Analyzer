import type { CsvColumns, CsvExtractOptions } from '@/io/csv';

/**
 * Messages exchanged with the analysis worker. Each request carries an id so
 * the client can match the reply to the promise that is waiting for it.
 */
export type WorkerRequest = {
  id: number;
  type: 'extractCsv';
  text: string;
  options: CsvExtractOptions;
};

export type WorkerResponse =
  | { id: number; ok: true; result: CsvColumns }
  | { id: number; ok: false; message: string; isImportError: boolean };
