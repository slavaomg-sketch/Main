import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, iphone15pro, prisma, usbcCable } from './fixtures';
import { applyImport, createImportJob, dryRunImport, setFieldOwner, setImportMapping } from '../imports/service';

const CSV = `Артикул поставщика;Название;Бренд;Категория;Цена;Остаток;Совместимые устройства
WB-1;Кабель импортный;UGREEN;cables;790;12;apple-iphone-15-pro
WB-2;Зарядка импортная;Baseus;chargers;1290;5;
CAB-100;Кабель USB-C — USB-C 100 Вт;UGREEN;cables;1390;99;
`;

describe('импорт CSV (интеграция)', () => {
  let f: Awaited<ReturnType<typeof freshDb>>;
  beforeEach(async () => {
    f = await freshDb();
  });

  it('анализ → сопоставление → dry-run → применение → повтор без дублей → ownership', async () => {
    await iphone15pro(f);
    const existing = await usbcCable(f, 10);
    const job = await createImportJob(prisma, { buffer: Buffer.from(CSV, 'utf8'), fileName: 'test.csv' });
    expect(job.status).toBe('ANALYZED');
    const analysis = job.analysis as { headers: string[]; totalRows: number };
    expect(analysis.totalRows).toBe(3);
    expect((job.mapping as Record<string, string>)['Артикул поставщика']).toBe('externalId');

    await setImportMapping(prisma, job.id, job.mapping as Record<string, never>, { sourceOwnedFields: ['price', 'stock'] });
    const dry = await dryRunImport(prisma, job.id);
    const summary = dry.summary as Record<string, number>;
    expect(summary).toMatchObject({ create: 2, update: 1, skip: 0, conflict: 0, error: 0 });

    const applied = await applyImport(prisma, job.id);
    expect(applied.status).toBe('COMPLETED');
    expect(await prisma.product.count()).toBe(3);
    const price = await prisma.price.findFirst({ where: { variantId: existing.variant.id, validTo: null } });
    expect(price?.amountMinor).toBe(139000);
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: existing.variant.id } })).quantity).toBe(99);
    expect(await prisma.compatibilityRelation.count({ where: { source: 'IMPORT' } })).toBe(1);
    expect(await prisma.externalListing.count()).toBe(3);

    // повторный импорт того же файла
    const job2 = await createImportJob(prisma, { buffer: Buffer.from(CSV, 'utf8'), fileName: 'test.csv' });
    expect((job2.analysis as { previousJobId: string | null }).previousJobId).toBe(job.id);
    await setImportMapping(prisma, job2.id, job2.mapping as Record<string, never>, {});
    const dry2 = await dryRunImport(prisma, job2.id);
    expect(dry2.summary).toMatchObject({ create: 0, update: 0, skip: 3 });
    await applyImport(prisma, job2.id);
    expect(await prisma.product.count()).toBe(3);
    expect(await prisma.productVariant.count()).toBe(3);

    // ручная правка цены защищает поле от источника
    await setFieldOwner(prisma, existing.product.id, 'price', 'MANUAL', existing.variant.id);
    const csv3 = CSV.replace('1390;99', '990;50');
    const job3 = await createImportJob(prisma, { buffer: Buffer.from(csv3, 'utf8'), fileName: 'test3.csv' });
    await setImportMapping(prisma, job3.id, job3.mapping as Record<string, never>, {});
    const dry3 = await dryRunImport(prisma, job3.id);
    expect(dry3.summary).toMatchObject({ update: 1, skip: 2 });
    const row = await prisma.importRow.findFirstOrThrow({ where: { jobId: job3.id, externalId: 'CAB-100' } });
    const diff = row.diff as { changes: Record<string, unknown>; protectedFields: string[] };
    expect(Object.keys(diff.changes)).toEqual(['stock']);
    expect(diff.protectedFields).toEqual(['price']);
  });

  it('дубликаты внутри файла и строки без ID попадают в конфликты/ошибки', async () => {
    const csv = `id;name;price\nA;Один;100\nA;Два;200\n;Без ID;300\n`;
    const job = await createImportJob(prisma, { buffer: Buffer.from(csv), fileName: 'dup.csv' });
    await setImportMapping(prisma, job.id, { id: 'externalId', name: 'name', price: 'priceMinor' }, {});
    const dry = await dryRunImport(prisma, job.id);
    expect(dry.summary).toMatchObject({ create: 1, conflict: 1, error: 1 });
  });
});
