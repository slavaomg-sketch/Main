import type { CreateShipmentInput, CreateShipmentResult, DeliveryProvider, DeliveryQuote, TrackingEvent } from './types';

/**
 * Заготовка адаптера СДЭК (API v2, OAuth client_credentials).
 * Включается только при CDEK_ACCOUNT и CDEK_SECURE_PASSWORD. Без ключей фабрика вернёт MockDeliveryProvider.
 */
export class CdekDeliveryProvider implements DeliveryProvider {
  readonly code = 'cdek';
  readonly mode = 'live' as const;
  private readonly base = 'https://api.cdek.ru/v2';
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly opts: { account: string; securePassword: string; senderCityCode: number }) {
    if (!opts.account || !opts.securePassword) throw new Error('CDEK: не заданы ключи');
  }

  private async auth(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.opts.account, client_secret: this.opts.securePassword });
    const res = await fetch(`${this.base}/oauth/token?${body.toString()}`, { method: 'POST' });
    if (!res.ok) throw new Error(`CDEK auth: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  async quote(input: { address: { city: string; postalCode?: string | null }; weightGrams: number; subtotalMinor: number }): Promise<DeliveryQuote[]> {
    const token = await this.auth();
    const res = await fetch(`${this.base}/calculator/tarifflist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 1,
        from_location: { code: this.opts.senderCityCode },
        to_location: { city: input.address.city, postal_code: input.address.postalCode ?? undefined },
        packages: [{ weight: input.weightGrams, length: 20, width: 15, height: 10 }],
      }),
    });
    if (!res.ok) throw new Error(`CDEK tarifflist: HTTP ${res.status}`);
    const data = (await res.json()) as { tariff_codes?: Array<{ tariff_code: number; tariff_name: string; delivery_sum: number; period_min: number; period_max: number; delivery_mode: number }> };
    return (data.tariff_codes ?? []).slice(0, 4).map((t) => ({
      methodCode: `cdek_${t.tariff_code}`,
      providerCode: this.code,
      name: t.tariff_name,
      description: `${t.period_min}–${t.period_max} дн.`,
      costMinor: Math.round(t.delivery_sum * 100),
      minDays: t.period_min,
      maxDays: t.period_max,
    }));
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const token = await this.auth();
    const tariff = Number(input.methodCode.replace('cdek_', ''));
    const res = await fetch(`${this.base}/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: input.orderPublicId,
        tariff_code: tariff,
        recipient: { name: input.recipient.fullName, phones: [{ number: input.recipient.phone }], email: input.recipient.email },
        from_location: { code: this.opts.senderCityCode },
        to_location: { city: input.address.city, address: `${input.address.street ?? ''} ${input.address.building ?? ''}`.trim(), postal_code: input.address.postalCode ?? undefined },
        packages: [{ number: '1', weight: input.weightGrams, items: [{ name: `Заказ ${input.orderPublicId}`, ware_key: input.orderPublicId, payment: { value: 0 }, cost: input.declaredValueMinor / 100, weight: input.weightGrams, amount: 1 }] }],
      }),
    });
    if (!res.ok) throw new Error(`CDEK createOrder: HTTP ${res.status}`);
    const data = (await res.json()) as { entity?: { uuid: string } };
    return { providerShipmentId: data.entity?.uuid ?? '', trackingNumber: null, estimatedAt: null };
  }

  async track(providerShipmentId: string): Promise<TrackingEvent[]> {
    const token = await this.auth();
    const res = await fetch(`${this.base}/orders/${providerShipmentId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`CDEK getOrder: HTTP ${res.status}`);
    const data = (await res.json()) as { entity?: { statuses?: Array<{ date_time: string; name: string; code: string }> } };
    return (data.entity?.statuses ?? []).map((s) => ({ at: new Date(s.date_time), status: s.code === 'DELIVERED' ? 'DELIVERED' : s.code === 'CREATED' ? 'LABEL_CREATED' : 'IN_TRANSIT', description: s.name }));
  }
}
