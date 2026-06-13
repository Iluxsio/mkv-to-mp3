import { Injectable, computed, inject, signal } from '@angular/core';
import { ConvMode, DEFAULT_SERVER_THRESHOLD_MB } from './config';
import { ConversionJob, baseName } from './models';
import { FfmpegClientService } from './ffmpeg-client.service';
import { ServerConvertService } from './server.service';

@Injectable({ providedIn: 'root' })
export class ConverterService {
  private readonly client = inject(FfmpegClientService);
  private readonly server = inject(ServerConvertService);

  readonly jobs = signal<ConversionJob[]>([]);
  readonly mode = signal<ConvMode>('auto');
  readonly thresholdMb = signal(DEFAULT_SERVER_THRESHOLD_MB);
  readonly running = signal(false);

  readonly serverAvailable = this.server.available;
  readonly engineLoading = this.client.loading;

  readonly hasJobs = computed(() => this.jobs().length > 0);
  readonly doneCount = computed(() => this.jobs().filter((j) => j.status === 'done').length);
  readonly pendingCount = computed(
    () => this.jobs().filter((j) => j.status === 'queued' || j.status === 'converting').length,
  );

  init(): void {
    void this.server.checkAvailability();
  }

  addFiles(files: FileList | File[]): void {
    const existing = this.jobs();
    const toAdd: ConversionJob[] = [];
    for (const file of Array.from(files)) {
      toAdd.push({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        sizeBytes: file.size,
        mode: 'client',
        status: 'queued',
        progress: 0,
        outputName: `${baseName(file.name)}.mp3`,
      });
    }
    this.jobs.set([...existing, ...toAdd]);
  }

  removeJob(id: string): void {
    const job = this.jobs().find((j) => j.id === id);
    if (job?.status === 'converting') return; // can't remove a running job; cancel first
    if (job?.outputUrl) URL.revokeObjectURL(job.outputUrl);
    this.jobs.set(this.jobs().filter((j) => j.id !== id));
  }

  cancelJob(id: string): void {
    const job = this.jobs().find((j) => j.id === id);
    if (job?.abort) job.abort();
    this.patch(id, { status: 'canceled', abort: undefined });
  }

  clearFinished(): void {
    for (const j of this.jobs()) {
      if ((j.status === 'done' || j.status === 'error' || j.status === 'canceled') && j.outputUrl) {
        URL.revokeObjectURL(j.outputUrl);
      }
    }
    this.jobs.set(this.jobs().filter((j) => j.status === 'queued' || j.status === 'converting'));
  }

  /** Decides where a given job runs, honoring the selected mode and availability. */
  private resolveMode(sizeBytes: number): 'client' | 'server' {
    const m = this.mode();
    if (m === 'client') return 'client';
    if (m === 'server') return this.server.available() ? 'server' : 'client';
    // auto: big files prefer the server when it is reachable.
    const overThreshold = sizeBytes > this.thresholdMb() * 1024 * 1024;
    return overThreshold && this.server.available() ? 'server' : 'client';
  }

  async convertAll(): Promise<void> {
    if (this.running()) return;
    this.running.set(true);
    try {
      for (const job of this.jobs()) {
        if (job.status !== 'queued') continue;
        await this.runJob(job.id);
      }
    } finally {
      this.running.set(false);
    }
  }

  async runJob(id: string): Promise<void> {
    const job = this.jobs().find((j) => j.id === id);
    if (!job || job.status === 'converting' || job.status === 'done') return;

    const mode = this.resolveMode(job.sizeBytes);
    this.patch(id, { status: 'converting', progress: 0, mode, error: undefined });

    try {
      let blob: Blob;
      if (mode === 'server') {
        const handle = this.server.convert(job.file, (r) => this.patch(id, { progress: r }));
        this.patch(id, { abort: handle.abort });
        blob = await handle.promise;
      } else {
        blob = await this.client.convert(job.file, (r) => this.patch(id, { progress: r }));
      }
      const url = URL.createObjectURL(blob);
      this.patch(id, {
        status: 'done',
        progress: 1,
        outputBlob: blob,
        outputUrl: url,
        abort: undefined,
      });
    } catch (err: unknown) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      this.patch(id, {
        status: aborted ? 'canceled' : 'error',
        error: aborted ? undefined : errorMessage(err),
        abort: undefined,
      });
    }
  }

  download(id: string): void {
    const job = this.jobs().find((j) => j.id === id);
    if (!job?.outputUrl) return;
    triggerDownload(job.outputUrl, job.outputName);
  }

  downloadAll(): void {
    for (const job of this.jobs()) {
      if (job.status === 'done' && job.outputUrl) triggerDownload(job.outputUrl, job.outputName);
    }
  }

  private patch(id: string, changes: Partial<ConversionJob>): void {
    this.jobs.set(this.jobs().map((j) => (j.id === id ? { ...j, ...changes } : j)));
  }
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
