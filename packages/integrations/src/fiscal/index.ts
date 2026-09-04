export interface FiscalReceiptItem {
  name: string;
  quantity: number;
  priceMinor: number;
  vat: 'none' | 'vat0' | 'vat10' | 'vat20';
}

export interface FiscalReceiptInput {
  orderPublicId: string;
  customerEmail: string;
  items: FiscalReceiptItem[];
  totalMinor: number;
  paymentMethod: 'card' | 'cash';
  type: 'sell' | 'sell_refund';
}

export interface FiscalReceiptProvider {
  readonly code: string;
  readonly mode: 'mock' | 'live';
  register(receipt: FiscalReceiptInput): Promise<{ providerReceiptId: string; status: 'PENDING' | 'DONE' | 'FAILED' }>;
}

export class MockFiscalReceiptProvider implements FiscalReceiptProvider {
  readonly code = 'mock';
  readonly mode = 'mock' as const;
  readonly receipts: FiscalReceiptInput[] = [];
  async register(receipt: FiscalReceiptInput) {
    this.receipts.push(receipt);
    return { providerReceiptId: `mock_receipt_${this.receipts.length}`, status: 'DONE' as const };
  }
}

/** Заготовка АТОЛ Онлайн (v4). Включается только при ATOL_LOGIN/ATOL_PASSWORD/ATOL_GROUP_CODE. */
export class AtolFiscalReceiptProvider implements FiscalReceiptProvider {
  readonly code = 'atol';
  readonly mode = 'live' as const;
  constructor(private readonly opts: { login: string; password: string; groupCode: string }) {
    if (!opts.login || !opts.password || !opts.groupCode) throw new Error('ATOL: не заданы ключи');
  }
  async register(receipt: FiscalReceiptInput): Promise<{ providerReceiptId: string; status: 'PENDING' | 'DONE' | 'FAILED' }> {
    throw new Error(`АТОЛ Онлайн: отправка чека ${receipt.orderPublicId} не реализована без production-ключей (group=${this.opts.groupCode})`);
  }
}
