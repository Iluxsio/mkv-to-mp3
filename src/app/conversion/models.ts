export type JobStatus = 'queued' | 'converting' | 'done' | 'error' | 'canceled';

export interface ConversionJob {
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  /** Where the conversion actually ran. */
  mode: 'client' | 'server';
  status: JobStatus;
  /** 0..1 */
  progress: number;
  outputName: string;
  outputUrl?: string;
  outputBlob?: Blob;
  error?: string;
  /** Aborts an in-flight server upload, if any. */
  abort?: () => void;
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '');
}
