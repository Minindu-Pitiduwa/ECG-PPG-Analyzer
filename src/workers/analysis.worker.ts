/// <reference lib="webworker" />
import { extractCsvColumns } from '@/io/csv';
import { ImportError } from '@/io/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const result = extractCsvColumns(request.text, request.options);
    const response: WorkerResponse = { id: request.id, ok: true, result };
    // Transfer the sample buffers instead of copying them back to the main thread.
    const buffers = [result.signal.buffer, ...(result.time ? [result.time.buffer] : [])];
    scope.postMessage(response, buffers);
  } catch (error) {
    const response: WorkerResponse = {
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      isImportError: error instanceof ImportError,
    };
    scope.postMessage(response);
  }
};
