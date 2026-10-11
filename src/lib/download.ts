/** Offer a generated file to the user as a download. Nothing is sent anywhere. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file-system-safe base name derived from a recording name. */
export function fileBaseName(recordingName: string): string {
  const base = recordingName
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return base || 'recording';
}
