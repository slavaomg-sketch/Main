import { randomUUID } from 'node:crypto';
import type { CreateShipmentInput, CreateShipmentResult, DeliveryProvider, DeliveryQuote, TrackingEvent } from './types';

const FREE_FROM = 300_000; // 3 000 ₽

/** MockDeliveryProvider — фиксированные тарифы для разработки и тестов. */
export class MockDeliveryProvider implements DeliveryProvider {
  readonly code = 'mock';
  readonly mode = 'mock' as const;

  async quote(input: { address: { city: string }; weightGrams: number; subtotalMinor: number }): Promise<DeliveryQuote[]> {
    const isMoscow = /москва|moscow/i.test(input.address.city);
    const heavy = input.weightGrams > 3000 ? 15_000 : 0;
    const free = input.subtotalMinor >= FREE_FROM;
    return [
      {
        methodCode: 'courier',
        providerCode: this.code,
        name: 'Курьером до двери',
        description: isMoscow ? 'По Москве, 1–2 дня' : 'По России, 2–5 дней',
        costMinor: free ? 0 : (isMoscow ? 39_000 : 49_000) + heavy,
        minDays: isMoscow ? 1 : 2,
        maxDays: isMoscow ? 2 : 5,
        freeFromMinor: FREE_FROM,
      },
      {
        methodCode: 'pickup',
        providerCode: this.code,
        name: 'Пункт выдачи',
        description: 'Более 5 000 пунктов по России, 2–4 дня',
        costMinor: free ? 0 : 19_000 + heavy,
        minDays: 2,
        maxDays: 4,
        freeFromMinor: FREE_FROM,
      },
      {
        methodCode: 'post',
        providerCode: this.code,
        name: 'Почта России',
        description: 'В отделение, 5–10 дней',
        costMinor: 29_000 + heavy,
        minDays: 5,
        maxDays: 10,
      },
    ];
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const id = `mock_ship_${randomUUID().slice(0, 8)}`;
    const days = input.methodCode === 'post' ? 7 : 3;
    return { providerShipmentId: id, trackingNumber: `TM${Date.now().toString().slice(-9)}`, estimatedAt: new Date(Date.now() + days * 86_400_000) };
  }

  async track(providerShipmentId: string): Promise<TrackingEvent[]> {
    return [{ at: new Date(), status: 'LABEL_CREATED', description: `Отправление ${providerShipmentId} создано (тестовый режим)` }];
  }
}
