import type { CsvColumns, CsvExtractOptions } from '@/io/csv';
import { ImportError } from '@/io/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface Pending {
  resolve: (result: CsvColumns) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(error: Error): void {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
}

/** Created on first use so the landing page does not pay for a worker it may never need. */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    if (response.ok) {
      waiting.resolve(response.result);
    } else {
      // Error classes do not survive postMessage, so the worker sends a flag instead.
      const ErrorType = response.isImportError ? ImportError : Error;
      waiting.reject(new ErrorType(response.message));
    }
  };
  worker.onerror = () => {
    failAll(new Error('The background worker stopped unexpectedly.'));
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Parse a whole CSV file off the main thread. */
export function extractCsvInWorker(text: string, options: CsvExtractOptions): Promise<CsvColumns> {
  return new Promise((resolve, reject) => {
    const request: WorkerRequest = { id: nextId++, type: 'extractCsv', text, options };
    pending.set(request.id, { resolve, reject });
    getWorker().postMessage(request);
  });
}
