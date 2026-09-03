import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MetricsService, MetricsSnapshot } from '../../services/metrics.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-metrics-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <div class="metrics-ribbon" [class.open]="isOpen">
      <!-- Toggle Tab -->
      <button class="ribbon-tab" (click)="toggle()" [matTooltip]="isOpen ? 'Close metrics' : 'System Metrics'">
        <mat-icon>{{isOpen ? 'chevron_right' : 'speed'}}</mat-icon>
      </button>

      <!-- Panel Content -->
      <div class="ribbon-content" *ngIf="isOpen">
        <div class="ribbon-header">
          <mat-icon>monitoring</mat-icon>
          <span>System Monitor</span>
          <span class="connection-dot" [class.connected]="connected"></span>
        </div>

        <!-- CPU Gauge -->
        <div class="metric-card">
          <div class="metric-header">
            <mat-icon>memory</mat-icon>
            <span class="metric-title">CPU</span>
            <span class="metric-value" [class]="getColorClass(metrics?.cpu?.total || 0)">
              {{ (metrics?.cpu?.total || 0) | number:'1.0-0' }}%
            </span>
          </div>
          <div class="gauge-bar">
            <div class="gauge-fill" [class]="getColorClass(metrics?.cpu?.total || 0)"
                 [style.width.%]="metrics?.cpu?.total || 0"></div>
          </div>
          <div class="metric-detail">
            <span>{{ metrics?.system?.cpuCores || 0 }} cores</span>
            <span>{{ metrics?.system?.cpuModel || '' | slice:0:28 }}</span>
          </div>
          <canvas #cpuCanvas class="sparkline" width="200" height="32"></canvas>
        </div>

        <!-- GPU Gauge -->
        <div class="metric-card">
          <div class="metric-header">
            <mat-icon>videocam</mat-icon>
            <span class="metric-title">GPU</span>
            <span class="metric-value" [class]="getColorClass(metrics?.gpu?.total || 0)">
              <ng-container *ngIf="metrics?.gpu?.available; else gpuNA">
                {{ (metrics?.gpu?.total || 0) | number:'1.0-0' }}%
              </ng-container>
              <ng-template #gpuNA><span class="na">N/A</span></ng-template>
            </span>
          </div>
          <div class="gauge-bar">
            <div class="gauge-fill" [class]="getColorClass(metrics?.gpu?.total || 0)"
                 [style.width.%]="metrics?.gpu?.available ? (metrics?.gpu?.total || 0) : 0"></div>
          </div>
          <div class="metric-detail" *ngIf="metrics?.gpu?.available">
            <span>Render: {{ metrics?.gpu?.render || 0 | number:'1.0-0' }}%</span>
            <span>Compute: {{ metrics?.gpu?.compute || 0 | number:'1.0-0' }}%</span>
          </div>
          <div class="metric-detail" *ngIf="metrics?.gpu?.available">
            <span>Video: {{ metrics?.gpu?.video || 0 | number:'1.0-0' }}%</span>
            <span *ngIf="metrics?.gpu?.frequency">{{ metrics?.gpu?.frequency | number:'1.0-0' }} MHz</span>
          </div>
          <div class="metric-detail" *ngIf="!metrics?.gpu?.available">
            <span class="na-text">qmassa not available</span>
          </div>
          <canvas #gpuCanvas class="sparkline" width="200" height="32"></canvas>
        </div>

        <!-- NPU Gauge -->
        <div class="metric-card">
          <div class="metric-header">
            <mat-icon>psychology</mat-icon>
            <span class="metric-title">NPU</span>
            <span class="metric-value" [class]="getColorClass(metrics?.npu?.utilization || 0)">
              <ng-container *ngIf="metrics?.npu?.available; else npuNA">
                {{ (metrics?.npu?.utilization || 0) | number:'1.0-0' }}%
              </ng-container>
              <ng-template #npuNA><span class="na">N/A</span></ng-template>
            </span>
          </div>
          <div class="gauge-bar">
            <div class="gauge-fill" [class]="getColorClass(metrics?.npu?.utilization || 0)"
                 [style.width.%]="metrics?.npu?.available ? (metrics?.npu?.utilization || 0) : 0"></div>
          </div>
          <div class="metric-detail" *ngIf="!metrics?.npu?.available">
            <span class="na-text">NPU sysfs not detected</span>
          </div>
          <canvas #npuCanvas class="sparkline" width="200" height="32"></canvas>
        </div>

        <!-- Memory -->
        <div class="metric-card">
          <div class="metric-header">
            <mat-icon>storage</mat-icon>
            <span class="metric-title">Memory</span>
            <span class="metric-value" [class]="getColorClass(metrics?.memory?.usedPercent || 0)">
              {{ (metrics?.memory?.usedPercent || 0) | number:'1.0-0' }}%
            </span>
          </div>
          <div class="gauge-bar">
            <div class="gauge-fill" [class]="getColorClass(metrics?.memory?.usedPercent || 0)"
                 [style.width.%]="metrics?.memory?.usedPercent || 0"></div>
          </div>
          <div class="metric-detail">
            <span>{{ metrics?.memory?.usedGB || 0 | number:'1.1-1' }} / {{ metrics?.memory?.totalGB || 0 | number:'1.1-1' }} GB</span>
          </div>
        </div>

        <!-- System Info Footer -->
        <div class="system-footer">
          <span>{{ metrics?.system?.platform || '' }}</span>
          <span>Uptime: {{ formatUptime(metrics?.system?.uptime || 0) }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      position: fixed;
      top: 64px;
      right: 0;
      bottom: 0;
      z-index: 999;
      pointer-events: none;
    }

    .metrics-ribbon {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: flex-start;
      pointer-events: auto;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .ribbon-tab {
      position: absolute;
      left: -36px;
      top: 50%;
      transform: translateY(-50%);
      width: 36px;
      height: 72px;
      border: none;
      border-radius: 8px 0 0 8px;
      background: var(--ribbon-tab-bg, #1976d2);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: -2px 2px 8px rgba(0,0,0,0.2);
      transition: background 0.2s;
    }
    .ribbon-tab:hover {
      background: var(--ribbon-tab-hover, #1565c0);
    }

    .ribbon-content {
      width: 240px;
      height: 100%;
      background: var(--ribbon-bg, #fafafa);
      border-left: 1px solid var(--ribbon-border, #e0e0e0);
      box-shadow: -4px 0 16px rgba(0,0,0,0.08);
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .ribbon-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 0.9em;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--ribbon-border, #e0e0e0);
    }

    .connection-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef5350;
      margin-left: auto;
    }
    .connection-dot.connected {
      background: #4caf50;
    }

    .metric-card {
      background: var(--metric-card-bg, #ffffff);
      border-radius: 8px;
      padding: 10px;
      border: 1px solid var(--ribbon-border, #e0e0e0);
    }

    .metric-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    .metric-header mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--metric-icon, #616161);
    }
    .metric-title {
      font-weight: 600;
      font-size: 0.82em;
      flex: 1;
    }
    .metric-value {
      font-weight: 700;
      font-size: 0.95em;
      font-family: 'Roboto Mono', monospace;
    }

    .gauge-bar {
      height: 6px;
      background: var(--gauge-bg, #e0e0e0);
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 4px;
    }
    .gauge-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.8s ease;
    }

    .level-green { color: #4caf50; }
    .level-green.gauge-fill { background: #4caf50; }
    .level-yellow { color: #ff9800; }
    .level-yellow.gauge-fill { background: #ff9800; }
    .level-red { color: #f44336; }
    .level-red.gauge-fill { background: #f44336; }

    .metric-detail {
      display: flex;
      justify-content: space-between;
      font-size: 0.7em;
      color: var(--metric-detail, #757575);
      margin-top: 2px;
    }

    .sparkline {
      width: 100%;
      height: 32px;
      margin-top: 4px;
      border-radius: 4px;
      background: var(--sparkline-bg, #f5f5f5);
    }

    .na {
      color: #9e9e9e;
      font-weight: 400;
      font-size: 0.85em;
    }
    .na-text {
      color: #9e9e9e;
      font-style: italic;
    }

    .system-footer {
      font-size: 0.68em;
      color: var(--metric-detail, #757575);
      display: flex;
      justify-content: space-between;
      padding-top: 6px;
      border-top: 1px solid var(--ribbon-border, #e0e0e0);
    }

    /* Dark theme overrides via CSS variables */
    :host-context(.dark-theme) .ribbon-content {
      --ribbon-bg: #1e1e1e;
      --ribbon-border: #333;
      --metric-card-bg: #2d2d2d;
      --metric-icon: #b0b0b0;
      --metric-detail: #a0a0a0;
      --gauge-bg: #404040;
      --sparkline-bg: #2a2a2a;
      color: #e0e0e0;
    }
    :host-context(.dark-theme) .ribbon-header,
    :host-context(.dark-theme) .metric-title {
      color: #f0f0f0;
    }
    :host-context(.dark-theme) .na,
    :host-context(.dark-theme) .na-text {
      color: #757575;
    }
    :host-context(.dark-theme) .ribbon-tab {
      --ribbon-tab-bg: #333;
      --ribbon-tab-hover: #444;
    }
  `]
})
export class MetricsPanelComponent implements OnInit, OnDestroy {
  isOpen = false;
  connected = false;
  metrics: MetricsSnapshot | null = null;

  private sub: Subscription | null = null;
  private connSub: Subscription | null = null;
  private historySub: Subscription | null = null;
  private cpuCanvasRef: HTMLCanvasElement | null = null;
  private gpuCanvasRef: HTMLCanvasElement | null = null;
  private npuCanvasRef: HTMLCanvasElement | null = null;

  constructor(private metricsService: MetricsService) {}

  ngOnInit(): void {
    // Don't connect until panel is opened
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.connSub?.unsubscribe();
    this.historySub?.unsubscribe();
    this.metricsService.disconnect();
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.metricsService.connect();
      this.sub = this.metricsService.metrics$.subscribe(m => {
        this.metrics = m;
        this.drawSparklines();
      });
      this.connSub = this.metricsService.connected$.subscribe(c => this.connected = c);
    } else {
      this.sub?.unsubscribe();
      this.connSub?.unsubscribe();
      this.historySub?.unsubscribe();
      this.metricsService.disconnect();
    }
  }

  getColorClass(value: number): string {
    if (value < 50) return 'level-green';
    if (value < 80) return 'level-yellow';
    return 'level-red';
  }

  formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  private drawSparklines(): void {
    const history = this.metricsService['historySubject']?.value || [];
    if (history.length < 2) return;

    setTimeout(() => {
      // CPU sparkline
      const cpuEl = document.querySelector('app-metrics-panel canvas.sparkline') as HTMLCanvasElement;
      if (cpuEl) this.drawLine(cpuEl, history.map(h => h.cpu.total));

      // GPU sparkline
      const canvases = document.querySelectorAll('app-metrics-panel canvas.sparkline');
      if (canvases[1]) this.drawLine(canvases[1] as HTMLCanvasElement, history.map(h => h.gpu.total));

      // NPU sparkline
      if (canvases[2]) this.drawLine(canvases[2] as HTMLCanvasElement, history.map(h => h.npu.utilization));
    });
  }

  private drawLine(canvas: HTMLCanvasElement, data: number[]): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    const max = 100;
    const step = w / (60 - 1); // always show 60-point scale

    // Fill area
    ctx.beginPath();
    ctx.moveTo(0, h);
    data.forEach((v, i) => {
      const x = (i + (60 - data.length)) * step;
      const y = h - (v / max) * h;
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo((60 - 1) * step, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(33, 150, 243, 0.1)';
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i + (60 - data.length)) * step;
      const y = h - (v / max) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
