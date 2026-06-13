import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConverterService } from './conversion/converter.service';
import { ConvMode } from './conversion/config';
import { ConversionJob } from './conversion/models';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly conv = inject(ConverterService);
  protected readonly dragging = signal(false);

  protected readonly jobs = this.conv.jobs;

  ngOnInit(): void {
    this.conv.init();
  }

  onFilePick(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.conv.addFiles(input.files);
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (event.dataTransfer?.files?.length) this.conv.addFiles(event.dataTransfer.files);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
  }

  setMode(mode: ConvMode): void {
    this.conv.mode.set(mode);
  }

  // ----- presentation helpers -----

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  statusLabel(job: ConversionJob): string {
    switch (job.status) {
      case 'queued':
        return 'En cola';
      case 'converting':
        return job.mode === 'server' ? 'Convirtiendo (servidor)…' : 'Convirtiendo…';
      case 'done':
        return 'Listo';
      case 'error':
        return 'Error';
      case 'canceled':
        return 'Cancelado';
    }
  }

  percent(job: ConversionJob): number {
    return Math.round(job.progress * 100);
  }

  trackJob(_: number, job: ConversionJob): string {
    return job.id;
  }
}
