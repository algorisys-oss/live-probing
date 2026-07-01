import type { Product } from "@shopwave/shared";

const img = (slug: string) => `https://picsum.photos/seed/${slug}/400/400`;

export const seedProducts: Product[] = [
  { id: "p-001", sku: "AUD-HP-01", name: "Aria Wireless Headphones", description: "Over-ear, 30h battery, ANC.", priceCents: 18900, currency: "USD", category: "audio", imageUrl: img("aria"), stock: 50 },
  { id: "p-002", sku: "AUD-EB-02", name: "Pulse Earbuds", description: "In-ear, sweatproof, USB-C.", priceCents: 8900, currency: "USD", category: "audio", imageUrl: img("pulse"), stock: 120 },
  { id: "p-003", sku: "COM-KB-01", name: "Meridian Mechanical Keyboard", description: "Hot-swap, 75%, RGB.", priceCents: 12900, currency: "USD", category: "computing", imageUrl: img("meridian"), stock: 40 },
  { id: "p-004", sku: "COM-MS-02", name: "Glide Wireless Mouse", description: "Ergo, 8k DPI, silent click.", priceCents: 5900, currency: "USD", category: "computing", imageUrl: img("glide"), stock: 80 },
  { id: "p-005", sku: "COM-MN-03", name: "Vista 27\" 4K Monitor", description: "IPS, 144Hz, USB-C 90W.", priceCents: 42900, currency: "USD", category: "computing", imageUrl: img("vista"), stock: 15 },
  { id: "p-006", sku: "HOM-LM-01", name: "Lumen Smart Lamp", description: "Tunable white, app control.", priceCents: 4900, currency: "USD", category: "home", imageUrl: img("lumen"), stock: 60 },
  { id: "p-007", sku: "HOM-MG-02", name: "Roast Ceramic Mug", description: "350ml, double-walled.", priceCents: 1900, currency: "USD", category: "home", imageUrl: img("roast"), stock: 200 },
  { id: "p-008", sku: "WEA-WT-01", name: "Tempo Fitness Watch", description: "HR, GPS, 7-day battery.", priceCents: 19900, currency: "USD", category: "wearables", imageUrl: img("tempo"), stock: 35 },
  { id: "p-009", sku: "WEA-BD-02", name: "Stride Fitness Band", description: "Sleep + steps, slim.", priceCents: 6900, currency: "USD", category: "wearables", imageUrl: img("stride"), stock: 90 },
  { id: "p-010", sku: "PWR-PB-01", name: "Volt 20k Power Bank", description: "20000mAh, 65W PD.", priceCents: 5900, currency: "USD", category: "power", imageUrl: img("volt"), stock: 110 },
  { id: "p-011", sku: "PWR-CH-02", name: "Nimbus GaN Charger", description: "100W, 3-port, foldable.", priceCents: 6900, currency: "USD", category: "power", imageUrl: img("nimbus"), stock: 70 },
  { id: "p-012", sku: "AUD-SP-03", name: "Echo Portable Speaker", description: "IP67, 24h, stereo pair.", priceCents: 9900, currency: "USD", category: "audio", imageUrl: img("echo"), stock: 55 },
];
