/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SimulatorService {
  private apiUrl = '/api/simulator';
  private _enabled = new BehaviorSubject<boolean>(false);

  enabled$ = this._enabled.asObservable();
  private intervalId: any = null;
  private _sceneActive = false;
  private eventSource: EventSource | null = null;

  constructor(private http: HttpClient, private zone: NgZone) {
    this.connectSSE();
  }

  private connectSSE(): void {
    this.eventSource = new EventSource(`${this.apiUrl}/events`);
    this.eventSource.onmessage = (event) => {
      this.zone.run(() => {
        const data = JSON.parse(event.data);
        const wasEnabled = this._enabled.value;
        this._enabled.next(data.enabled);

        if (data.enabled && !wasEnabled) {
          this.onStart();
        } else if (!data.enabled && wasEnabled) {
          this.onStop();
        }
      });
    };
    this.eventSource.onerror = () => {
      // Reconnect after a delay
      this.eventSource?.close();
      setTimeout(() => this.connectSSE(), 3000);
    };
  }

  get isEnabled(): boolean {
    return this._enabled.value;
  }

  toggle(): void {
    this.http.put<{ enabled: boolean }>(`${this.apiUrl}/toggle`, {}).subscribe();
  }

  start(): void {
    this.http.put<{ enabled: boolean }>(`${this.apiUrl}/toggle`, { enabled: true }).subscribe();
  }

  stop(): void {
    this.http.put<{ enabled: boolean }>(`${this.apiUrl}/toggle`, { enabled: false }).subscribe();
  }

  private onStart(): void {
    if (!this._sceneActive) {
      this.scheduleNext();
    }
  }

  private onStop(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
  }

  private scheduleNext(): void {
    if (!this._enabled.value || this._sceneActive) return;
    const delay = Math.random() * 10000 + 5000; // 5-15 seconds
    this.intervalId = setTimeout(() => {
      this.generateTransaction().subscribe({
        next: () => this.scheduleNext(),
        error: () => this.scheduleNext()
      });
    }, delay);
  }

  setSceneActive(active: boolean): void {
    this._sceneActive = active;
    if (active) {
      if (this.intervalId) {
        clearTimeout(this.intervalId);
        this.intervalId = null;
      }
    } else if (this._enabled.value) {
      this.scheduleNext();
    }
  }

  generateTransaction(options?: { order_type?: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/generate-transaction`, options || {});
  }
}
