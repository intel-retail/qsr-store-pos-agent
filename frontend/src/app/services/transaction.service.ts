import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Transaction {
  id: string;
  transaction_number: string;
  staff_id: string;
  staff_name: string;
  customer_name: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  payment_method: string;
  status: string;
  source: string;
  created_at: string;
  items?: TransactionItem[];
}

export interface TransactionItem {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
}

export interface CreateTransactionRequest {
  staff_id?: string;
  customer_id?: string;
  items: { product_id: string; quantity: number; discount?: number }[];
  payment_method: string;
  source: string;
}

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private apiUrl = '/api/transactions';

  constructor(private http: HttpClient) {}

  getTransactions(params?: { source?: string; limit?: number; from?: string }): Observable<Transaction[]> {
    return this.http.get<Transaction[]>(this.apiUrl, { params: params as any });
  }

  getTransaction(id: string): Observable<Transaction> {
    return this.http.get<Transaction>(`${this.apiUrl}/${id}`);
  }

  createTransaction(data: CreateTransactionRequest): Observable<Transaction> {
    return this.http.post<Transaction>(this.apiUrl, data);
  }

  getStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/stats/summary`);
  }
}
