import { Injectable, signal } from '@angular/core';
import { Product } from './product.service';

export interface CartItem {
  product: Product;
  quantity: number;
}

@Injectable({ providedIn: 'root' })
export class CartService {
  items = signal<CartItem[]>([]);

  get subtotal(): number {
    return this.items().reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  }

  get tax(): number {
    return this.subtotal * 0.08;
  }

  get total(): number {
    return this.subtotal + this.tax;
  }

  get itemCount(): number {
    return this.items().reduce((sum, item) => sum + item.quantity, 0);
  }

  addItem(product: Product): void {
    const current = this.items();
    const existing = current.find(i => i.product.id === product.id);
    if (existing) {
      this.items.set(current.map(i =>
        i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
      ));
    } else {
      this.items.set([...current, { product, quantity: 1 }]);
    }
  }

  removeItem(productId: string): void {
    this.items.set(this.items().filter(i => i.product.id !== productId));
  }

  updateQuantity(productId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeItem(productId);
      return;
    }
    this.items.set(this.items().map(i =>
      i.product.id === productId ? { ...i, quantity } : i
    ));
  }

  clear(): void {
    this.items.set([]);
  }
}
