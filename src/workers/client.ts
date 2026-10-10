import { ImportError } from '@/io/types';
import type { WorkerApi, WorkerJob, WorkerRequest, WorkerResponse } from './protocol';

interface Pending {
  resolve: (result: WorkerApi[WorkerJob]['result']) => void;
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

/**
 * Run a job off the main thread. Parameters are copied to the worker, so the
 * caller keeps its own data; large results are transferred back without a copy.
 */
export function runInWorker<Job extends WorkerJob>(
  job: Job,
  params: WorkerApi[Job]['params'],
): Promise<WorkerApi[Job]['result']> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {
      // The worker answers a job with that job's result type; the id ties the two together.
      resolve: (result) => resolve(result as WorkerApi[Job]['result']),
      reject,
    });
    getWorker().postMessage({ id, job, params } as WorkerRequest);
  });
}
