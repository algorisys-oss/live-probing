export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  category: string;
  imageUrl: string;
  stock: number;
}

export interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  priceCents: number;
  lineTotalCents: number;
}

export interface Cart {
  items: CartItem[];
  totalCents: number;
  currency: string;
}

export interface OrderItem {
  productId?: string;
  name?: string;
  quantity?: number;
  priceCents?: number;
}

export interface Order {
  id: string;
  status: string;
  totalCents: number;
  currency: string;
  items: OrderItem[];
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  userId: string;
}
