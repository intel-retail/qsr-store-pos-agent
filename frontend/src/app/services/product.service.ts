/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category_id: string;
  category_name: string;
  price: number;
  cost: number;
  stock_quantity: number;
  unit: string;
  image_url: string;
  is_active: boolean;
}

export interface Category {
  id: string;
  name: string;
  description: string;
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private apiUrl = '/api/products';

  constructor(private http: HttpClient) {}

  getProducts(params?: { category?: string; search?: string }): Observable<Product[]> {
    const cleanParams: Record<string, string> = {};
    if (params?.category) cleanParams['category'] = params.category;
    if (params?.search) cleanParams['search'] = params.search;
    return this.http.get<Product[]>(this.apiUrl, { params: cleanParams });
  }

  getProduct(id: string): Observable<Product> {
    return this.http.get<Product>(`${this.apiUrl}/${id}`);
  }

  getCategories(): Observable<Category[]> {
    return this.http.get<Category[]>('/api/categories');
  }
}
