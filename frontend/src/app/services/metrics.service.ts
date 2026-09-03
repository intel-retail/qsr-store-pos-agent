import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface CpuMetrics {
  user: number;
  system: number;
  idle: number;
  total: number;
}

export interface GpuMetrics {
  render: number;
  compute: number;
  video: number;
  copy: number;
  videoEnhance: number;
  frequency: number;
  power: number;
  total: number;
  available: boolean;
}

export interface NpuMetrics {
  utilization: number;
  available: boolean;
}

export interface MemoryMetrics {
  usedPercent: number;
  totalGB: number;
  usedGB: number;
}

export interface SystemInfo {
  platform: string;
  cpuModel: string;
  cpuCores: number;
  uptime: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  cpu: CpuMetrics;
  gpu: GpuMetrics;
  npu: NpuMetrics;
  memory: MemoryMetrics;
  system: SystemInfo;
}

@Injectable({ providedIn: 'root' })
export class MetricsService {
  private eventSource: EventSource | null = null;
  private metricsSubject = new BehaviorSubject<MetricsSnapshot | null>(null);
  private connectedSubject = new BehaviorSubject<boolean>(false);
  private historySubject = new BehaviorSubject<MetricsSnapshot[]>([]);
  private maxHistory = 60;

  metrics$ = this.metricsSubject.asObservable();
  connected$ = this.connectedSubject.asObservable();
  history$ = this.historySubject.asObservable();

  constructor(private ngZone: NgZone) {}

  connect(): void {
    if (this.eventSource) return;

    this.ngZone.runOutsideAngular(() => {
      this.eventSource = new EventSource('/api/metrics/stream');

      this.eventSource.onopen = () => {
        this.ngZone.run(() => this.connectedSubject.next(true));
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data: MetricsSnapshot = JSON.parse(event.data);
          this.ngZone.run(() => {
            this.metricsSubject.next(data);
            const history = this.historySubject.value;
            const updated = [...history, data];
            if (updated.length > this.maxHistory) {
              updated.splice(0, updated.length - this.maxHistory);
            }
            this.historySubject.next(updated);
          });
        } catch (e) {
          // Skip malformed messages
        }
      };

      this.eventSource.onerror = () => {
        this.ngZone.run(() => this.connectedSubject.next(false));
      };
    });
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.connectedSubject.next(false);
    }
  }

  get isConnected(): boolean {
    return this.connectedSubject.value;
  }
}
