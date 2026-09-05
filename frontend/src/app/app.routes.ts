/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Routes } from '@angular/router';
import { PosComponent } from './pages/pos/pos.component';
import { TransactionsComponent } from './pages/transactions/transactions.component';
import { SimulatorComponent } from './pages/simulator/simulator.component';
import { ConfigComponent } from './pages/config/config.component';
import { ChatComponent } from './pages/chat/chat.component';

export const routes: Routes = [
  { path: '', redirectTo: 'pos', pathMatch: 'full' },
  { path: 'pos', component: PosComponent },
  { path: 'transactions', component: TransactionsComponent },
  { path: 'simulator', component: SimulatorComponent },
  { path: 'chat', component: ChatComponent },
  { path: 'config', component: ConfigComponent }
];
