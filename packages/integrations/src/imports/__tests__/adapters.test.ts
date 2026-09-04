import { describe, expect, it } from 'vitest';
import { CsvImportAdapter } from '../csv';
import { XlsxImportAdapter, buildXlsx } from '../xlsx';
import { YmlImportAdapter, buildYmlFeed } from '../yml';
import { applyMapping, guessMapping, parseMoneyToMinor } from '../types';

describe('import adapters', () => {
  it('CSV с «;» и русскими заголовками', async () => {
    const csv = 'Артикул поставщика;Название;Цена, ₽;Остаток\nA-1;Кабель USB-C;1 490,50;12\nA-2;Зарядка;1990;0\n';
    const table = await new CsvImportAdapter().parse(Buffer.from(csv, 'utf8'));
    expect(table.headers).toEqual(['Артикул поставщика', 'Название', 'Цена, ₽', 'Остаток']);
    expect(table.totalRows).toBe(2);
    const mapping = guessMapping(table.headers);
    expect(mapping).toMatchObject({ 'Артикул поставщика': 'externalId', Название: 'name', 'Цена, ₽': 'priceMinor', Остаток: 'stock' });
    const { row, errors } = applyMapping(table.rows[0]!, mapping);
    expect(errors).toEqual([]);
    expect(row).toMatchObject({ externalId: 'A-1', name: 'Кабель USB-C', priceMinor: 149050, stock: 12 });
  });

  it('XLSX round-trip', async () => {
    const buf = buildXlsx([{ id: 'X1', name: 'Хаб', price: 3490 }]);
    const table = await new XlsxImportAdapter().parse(buf);
    expect(table.rows[0]).toMatchObject({ id: 'X1', name: 'Хаб', price: '3490' });
  });

  it('YML feed round-trip', async () => {
    const xml = buildYmlFeed({
      shopName: 'TechMatch',
      company: 'TechMatch',
      url: 'https://example.com',
      categories: [{ id: '1', name: 'Кабели' }],
      offers: [{ id: 'P1', url: 'https://example.com/p1', price: 1490, currency: 'RUR', categoryId: '1', pictures: ['https://example.com/1.jpg'], name: 'Кабель', available: true, params: [{ name: 'Длина', value: '2 м' }] }],
    });
    const table = await new YmlImportAdapter().parse(Buffer.from(xml));
    expect(table.rows[0]).toMatchObject({ id: 'P1', name: 'Кабель', price: '1490.00', categoryId: 'Кабели', 'param:Длина': '2 м' });
  });

  it('деньги парсятся в копейки', () => {
    expect(parseMoneyToMinor('1 990 ₽')).toBe(199000);
    expect(parseMoneyToMinor('12,5')).toBe(1250);
    expect(parseMoneyToMinor('abc')).toBeUndefined();
  });

  it('строка без внешнего ID — ошибка', () => {
    const r = applyMapping({ name: 'x' }, { name: 'name' });
    expect(r.row).toBeNull();
    expect(r.errors[0]).toMatch(/внешний ID/i);
  });
});
