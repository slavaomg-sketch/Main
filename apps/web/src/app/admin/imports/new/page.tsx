import { prisma } from '@techmatch/database';
import { requireAdmin } from '@/lib/admin';
import { AdminPage } from '@/components/admin/ui';
import { UploadForm } from './form';

export default async function NewImportPage() {
  await requireAdmin('imports.write');
  const sources = await prisma.externalSource.findMany({ where: { type: { in: ['CSV', 'XLSX', 'YML'] } }, orderBy: { name: 'asc' } });
  return (
    <AdminPage title="Новый импорт" description="Шаги: загрузка → анализ → сопоставление столбцов → проверка и dry-run → отчёт → подтверждение → применение">
      <UploadForm sources={sources.map((s) => ({ code: s.code, name: s.name }))} />
    </AdminPage>
  );
}
