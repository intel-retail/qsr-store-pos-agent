import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface McpServerStatus {
  status: 'running' | 'stopped' | 'error';
  pid: number | null;
  experience?: string;
  message?: string;
}

export interface McpStatus {
  pos: McpServerStatus;
  tableStatus: McpServerStatus;
  // Legacy
  status: 'running' | 'stopped' | 'error';
  pid: number | null;
}

export interface McpConfig {
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
}

@Injectable({ providedIn: 'root' })
export class McpService {
  private apiUrl = '/api/mcp';

  constructor(private http: HttpClient) {}

  getStatus(): Observable<McpStatus> {
    return this.http.get<McpStatus>(`${this.apiUrl}/status`);
  }

  start(): Observable<McpServerStatus> {
    return this.http.post<McpServerStatus>(`${this.apiUrl}/start`, {});
  }

  stop(): Observable<McpServerStatus> {
    return this.http.post<McpServerStatus>(`${this.apiUrl}/stop`, {});
  }

  startTableStatus(): Observable<McpServerStatus> {
    return this.http.post<McpServerStatus>(`${this.apiUrl}/table-status/start`, {});
  }

  stopTableStatus(): Observable<McpServerStatus> {
    return this.http.post<McpServerStatus>(`${this.apiUrl}/table-status/stop`, {});
  }

  getConfig(): Observable<McpConfig> {
    return this.http.get<McpConfig>(`${this.apiUrl}/config`);
  }
}
