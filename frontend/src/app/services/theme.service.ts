/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private darkMode = signal(false);

  currentTheme = () => this.darkMode() ? 'dark-theme' : 'light-theme';
  isDark = () => this.darkMode();

  constructor() {
    const saved = localStorage.getItem('pos-theme');
    if (saved === 'dark') {
      this.darkMode.set(true);
    }
  }

  toggleTheme(): void {
    this.darkMode.update(v => !v);
    localStorage.setItem('pos-theme', this.darkMode() ? 'dark' : 'light');
  }
}
