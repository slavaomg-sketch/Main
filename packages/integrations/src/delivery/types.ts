export interface DeliveryAddress {
  country: string;
  region?: string | null;
  city: string;
  street?: string;
  building?: string;
  apartment?: string | null;
  postalCode?: string | null;
}

export interface DeliveryQuote {
  methodCode: string; // courier, pickup, post
  providerCode: string;
  name: string;
  description: string;
  costMinor: number;
  minDays: number;
  maxDays: number;
  freeFromMinor?: number;
}

export interface CreateShipmentInput {
  orderPublicId: string;
  methodCode: string;
  address: DeliveryAddress;
  recipient: { fullName: string; phone: string; email: string };
  weightGrams: number;
  declaredValueMinor: number;
}

export interface CreateShipmentResult {
  providerShipmentId: string;
  trackingNumber: string | null;
  estimatedAt: Date | null;
}

export interface TrackingEvent {
  at: Date;
  status: 'PENDING' | 'LABEL_CREATED' | 'IN_TRANSIT' | 'DELIVERED' | 'RETURNED' | 'CANCELLED';
  description: string;
}

export interface DeliveryProvider {
  readonly code: string;
  readonly mode: 'mock' | 'live';
  quote(input: { address: DeliveryAddress; weightGrams: number; subtotalMinor: number }): Promise<DeliveryQuote[]>;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  track(providerShipmentId: string): Promise<TrackingEvent[]>;
}
