/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ProductService, Product, Category } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { TransactionService } from '../../services/transaction.service';

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule,
    MatChipsModule, MatBadgeModule, MatSnackBarModule, MatInputModule, MatFormFieldModule
  ],
  template: `
    <div class="pos-layout">
      <!-- Product Area -->
      <div class="products-area">
        <!-- Search & Categories -->
        <div class="controls">
          <mat-form-field appearance="outline" class="search-field">
            <mat-label>Search products...</mat-label>
            <input matInput [(ngModel)]="searchTerm" (ngModelChange)="filterProducts()">
            <mat-icon matSuffix>search</mat-icon>
          </mat-form-field>

          <div class="categories">
            <button mat-stroked-button
                    [class.active]="!selectedCategory"
                    (click)="selectCategory(null)">
              All
            </button>
            <button mat-stroked-button
                    *ngFor="let cat of categories"
                    [class.active]="selectedCategory === cat.id"
                    (click)="selectCategory(cat.id)">
              {{ cat.name }}
            </button>
          </div>
        </div>

        <!-- Product Grid -->
        <div class="product-grid">
          <div class="product-card" *ngFor="let product of filteredProducts"
               (click)="addToCart(product)">
            <div class="product-icon">🛍️</div>
            <div class="product-name">{{ product.name }}</div>
            <div class="product-price">\${{ product.price | number:'1.2-2' }}</div>
            <div class="product-stock">Stock: {{ product.stock_quantity }}</div>
          </div>
        </div>
      </div>

      <!-- Cart Panel -->
      <div class="cart-panel">
        <div class="cart-header">
          <h3>
            <mat-icon>shopping_cart</mat-icon>
            Cart ({{ cart.itemCount }} items)
          </h3>
          <button mat-icon-button (click)="cart.clear()" *ngIf="cart.itemCount > 0">
            <mat-icon>delete_sweep</mat-icon>
          </button>
        </div>

        <div class="cart-items">
          <div class="cart-item" *ngFor="let item of cart.items()">
            <div class="item-info">
              <div class="item-name">{{ item.product.name }}</div>
              <div class="item-price">\${{ item.product.price | number:'1.2-2' }} each</div>
            </div>
            <div class="item-controls">
              <button mat-icon-button (click)="cart.updateQuantity(item.product.id, item.quantity - 1)">
                <mat-icon>remove</mat-icon>
              </button>
              <span class="quantity">{{ item.quantity }}</span>
              <button mat-icon-button (click)="cart.updateQuantity(item.product.id, item.quantity + 1)">
                <mat-icon>add</mat-icon>
              </button>
              <button mat-icon-button color="warn" (click)="cart.removeItem(item.product.id)">
                <mat-icon>close</mat-icon>
              </button>
            </div>
            <div class="item-total">\${{ (item.product.price * item.quantity) | number:'1.2-2' }}</div>
          </div>

          <div class="empty-cart" *ngIf="cart.itemCount === 0">
            <mat-icon>shopping_cart</mat-icon>
            <p>Cart is empty</p>
          </div>
        </div>

        <div class="cart-total">
          <div class="total-row">
            <span>Subtotal:</span>
            <span>\${{ cart.subtotal | number:'1.2-2' }}</span>
          </div>
          <div class="total-row">
            <span>Tax (8%):</span>
            <span>\${{ cart.tax | number:'1.2-2' }}</span>
          </div>
          <div class="total-row grand-total">
            <span>Total:</span>
            <span>\${{ cart.total | number:'1.2-2' }}</span>
          </div>

          <div class="payment-buttons" *ngIf="cart.itemCount > 0">
            <button class="btn-accent" (click)="checkout('cash')">
              <mat-icon>payments</mat-icon> Cash
            </button>
            <button class="btn-accent" (click)="checkout('credit_card')">
              <mat-icon>credit_card</mat-icon> Card
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .products-area {
      overflow-y: auto;
      padding: 16px;
    }
    .controls {
      margin-bottom: 16px;
    }
    .search-field {
      width: 100%;
    }
    .categories {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .categories button.active {
      background-color: var(--accent);
      color: white;
    }
    .product-icon {
      font-size: 2em;
      margin-bottom: 8px;
    }
    .product-stock {
      font-size: 0.8em;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    .cart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      border-bottom: 1px solid var(--border);
    }
    .cart-header h3 {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .item-info {
      flex: 1;
    }
    .item-name {
      font-weight: 500;
    }
    .item-price {
      font-size: 0.85em;
      color: var(--text-secondary);
    }
    .item-controls {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .quantity {
      min-width: 24px;
      text-align: center;
      font-weight: 700;
    }
    .item-total {
      font-weight: 700;
      min-width: 60px;
      text-align: right;
    }
    .empty-cart {
      text-align: center;
      padding: 48px 16px;
      color: var(--text-secondary);
    }
    .empty-cart mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .grand-total {
      font-size: 1.3em;
      font-weight: 700;
      border-top: 2px solid var(--border);
      padding-top: 8px;
      margin-top: 8px;
    }
    .payment-buttons {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    .payment-buttons .btn-accent {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px;
      font-size: 1em;
    }
  `]
})
export class PosComponent implements OnInit {
  products: Product[] = [];
  filteredProducts: Product[] = [];
  categories: Category[] = [];
  selectedCategory: string | null = null;
  searchTerm = '';

  constructor(
    private productService: ProductService,
    public cart: CartService,
    private transactionService: TransactionService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadProducts();
    this.loadCategories();
  }

  loadProducts(): void {
    this.productService.getProducts({ search: this.searchTerm || undefined, category: this.selectedCategory || undefined })
      .subscribe({
        next: (products) => {
          this.products = products;
          this.filteredProducts = products;
        },
        error: (err) => console.error('Failed to load products:', err)
      });
  }

  loadCategories(): void {
    this.productService.getCategories().subscribe({
      next: (cats) => this.categories = cats,
      error: (err) => console.error('Failed to load categories:', err)
    });
  }

  selectCategory(categoryId: string | null): void {
    this.selectedCategory = categoryId;
    this.filterProducts();
  }

  filterProducts(): void {
    let filtered = this.products;
    if (this.selectedCategory) {
      filtered = filtered.filter(p => p.category_id === this.selectedCategory);
    }
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)
      );
    }
    this.filteredProducts = filtered;
  }

  addToCart(product: Product): void {
    this.cart.addItem(product);
  }

  checkout(paymentMethod: string): void {
    const items = this.cart.items().map(i => ({
      product_id: i.product.id,
      quantity: i.quantity
    }));

    this.transactionService.createTransaction({
      items,
      payment_method: paymentMethod,
      source: 'pos'
    }).subscribe({
      next: (txn) => {
        this.snackBar.open(`Transaction ${txn.transaction_number} completed!`, 'OK', { duration: 3000 });
        this.cart.clear();
        this.loadProducts();
      },
      error: (err) => {
        const msg = err.error?.error || 'Transaction failed. Please try again.';
        this.snackBar.open(msg, 'OK', { duration: 5000 });
      }
    });
  }
}
