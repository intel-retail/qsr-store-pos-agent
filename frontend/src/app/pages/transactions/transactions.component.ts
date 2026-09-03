import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { TransactionService, Transaction } from '../../services/transaction.service';
import { trigger, state, style, transition, animate } from '@angular/animations';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatChipsModule, MatIconModule, MatButtonModule, MatCardModule, MatTooltipModule, MatSelectModule, MatFormFieldModule],
  animations: [
    trigger('detailExpand', [
      state('collapsed,void', style({ height: '0px', minHeight: '0' })),
      state('expanded', style({ height: '*' })),
      transition('expanded <=> collapsed', animate('225ms cubic-bezier(0.4, 0.0, 0.2, 1)')),
    ]),
  ],
  template: `
    <div class="transactions-page">
      <!-- Stats Cards -->
      <div class="stats-row">
        <mat-card class="stat-card">
          <mat-icon>receipt</mat-icon>
          <div class="stat-value">{{ stats?.total_transactions || 0 }}</div>
          <div class="stat-label">Today's Transactions</div>
        </mat-card>
        <mat-card class="stat-card">
          <mat-icon>attach_money</mat-icon>
          <div class="stat-value">\${{ stats?.total_revenue | number:'1.2-2' }}</div>
          <div class="stat-label">Total Revenue</div>
        </mat-card>
        <mat-card class="stat-card">
          <mat-icon>point_of_sale</mat-icon>
          <div class="stat-value">{{ stats?.pos_transactions || 0 }}</div>
          <div class="stat-label">POS Sales</div>
        </mat-card>
        <mat-card class="stat-card">
          <mat-icon>sports_esports</mat-icon>
          <div class="stat-value">{{ stats?.simulator_transactions || 0 }}</div>
          <div class="stat-label">Simulator Sales</div>
        </mat-card>
      </div>

      <!-- Transactions Table -->
      <div class="table-container card">
        <div class="table-header">
          <h3>Recent Transactions</h3>
          <mat-form-field appearance="outline" class="limit-select">
            <mat-label>Show</mat-label>
            <mat-select [(ngModel)]="recordLimit" (selectionChange)="loadTransactions()">
              <mat-option [value]="10">10</mat-option>
              <mat-option [value]="25">25</mat-option>
              <mat-option [value]="50">50</mat-option>
              <mat-option [value]="100">100</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
        <table mat-table [dataSource]="transactions" multiTemplateDataRows class="full-width">
          <ng-container matColumnDef="transaction_number">
            <th mat-header-cell *matHeaderCellDef>Transaction #</th>
            <td mat-cell *matCellDef="let txn">{{ txn.transaction_number }}</td>
          </ng-container>

          <ng-container matColumnDef="created_at">
            <th mat-header-cell *matHeaderCellDef>Date</th>
            <td mat-cell *matCellDef="let txn">{{ txn.created_at | date:'short' }}</td>
          </ng-container>

          <ng-container matColumnDef="staff_name">
            <th mat-header-cell *matHeaderCellDef>Staff</th>
            <td mat-cell *matCellDef="let txn">{{ txn.staff_name || 'N/A' }}</td>
          </ng-container>

          <ng-container matColumnDef="total">
            <th mat-header-cell *matHeaderCellDef>Total</th>
            <td mat-cell *matCellDef="let txn">\${{ txn.total | number:'1.2-2' }}</td>
          </ng-container>

          <ng-container matColumnDef="payment_method">
            <th mat-header-cell *matHeaderCellDef>Payment</th>
            <td mat-cell *matCellDef="let txn">{{ txn.payment_method }}</td>
          </ng-container>

          <ng-container matColumnDef="source">
            <th mat-header-cell *matHeaderCellDef>Source</th>
            <td mat-cell *matCellDef="let txn">
              <span class="source-badge" [class.simulator]="txn.source === 'simulator'">
                {{ txn.source }}
              </span>
            </td>
          </ng-container>

          <!-- Expanded row for items -->
          <ng-container matColumnDef="expandedDetail">
            <td mat-cell *matCellDef="let txn" [attr.colspan]="displayedColumns.length">
              <div class="detail-row" [@detailExpand]="txn === expandedTxn ? 'expanded' : 'collapsed'">
                <div class="detail-content" *ngIf="txn === expandedTxn">
                  <div class="items-chips" *ngIf="txn.items?.length > 0">
                    <span class="item-chip" *ngFor="let item of txn.items">
                      {{ item.product_name }} &times;{{ item.quantity }}
                      <span class="item-price">\${{ item.total | number:'1.2-2' }}</span>
                    </span>
                  </div>
                  <div class="items-loading" *ngIf="!txn.items">Loading...</div>
                </div>
              </div>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"
              class="txn-row"
              [class.expanded-row]="expandedTxn === row"
              (click)="toggleRow(row)"></tr>
          <tr mat-row *matRowDef="let row; columns: ['expandedDetail']" class="detail-row-def"></tr>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .transactions-page {
      padding: 24px;
    }
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      text-align: center;
      padding: 24px;
    }
    .stat-card mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: var(--accent);
    }
    .stat-value {
      font-size: 2em;
      font-weight: 700;
      margin: 8px 0;
    }
    .stat-label {
      color: var(--text-secondary);
    }
    .table-container {
      overflow-x: auto;
    }
    .table-container h3 {
      margin-bottom: 16px;
    }
    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .limit-select {
      width: 90px;
      font-size: 0.85em;
    }
    .full-width {
      width: 100%;
    }
    .source-badge {
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85em;
      background: var(--accent);
      color: white;
    }
    .source-badge.simulator {
      background: var(--warning);
    }
    .txn-row {
      cursor: pointer;
    }
    .txn-row:hover {
      background: rgba(128, 128, 128, 0.06);
    }
    .expanded-row {
      background: rgba(128, 128, 128, 0.04);
    }
    .detail-row-def {
      height: 0;
    }
    .detail-row {
      overflow: hidden;
    }
    .detail-content {
      padding: 8px 16px 12px;
    }
    .items-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .item-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 14px;
      font-size: 0.8em;
      background: rgba(128, 128, 128, 0.1);
      border: 1px solid var(--border);
    }
    .item-price {
      font-weight: 600;
      color: var(--accent);
    }
    .items-loading {
      font-size: 0.85em;
      color: var(--text-secondary);
    }
  `]
})
export class TransactionsComponent implements OnInit, OnDestroy {
  transactions: Transaction[] = [];
  stats: any = {};
  displayedColumns = ['transaction_number', 'created_at', 'staff_name', 'total', 'payment_method', 'source'];
  expandedTxn: Transaction | null = null;
  recordLimit = 25;
  private pollInterval: any;

  constructor(private transactionService: TransactionService) {}

  ngOnInit(): void {
    this.loadTransactions();
    this.loadStats();
    this.pollInterval = setInterval(() => {
      this.loadTransactions();
      this.loadStats();
    }, 5000);
  }

  ngOnDestroy(): void {
    clearInterval(this.pollInterval);
  }

  loadTransactions(): void {
    const today = new Date().toISOString().split('T')[0];
    this.transactionService.getTransactions({ limit: this.recordLimit, from: today }).subscribe(t => this.transactions = t);
  }

  loadStats(): void {
    this.transactionService.getStats().subscribe(s => this.stats = s);
  }

  toggleRow(txn: Transaction): void {
    if (this.expandedTxn === txn) {
      this.expandedTxn = null;
    } else {
      this.expandedTxn = txn;
      if (!txn.items) {
        this.transactionService.getTransaction(txn.id).subscribe(full => {
          txn.items = full.items;
        });
      }
    }
  }
}
