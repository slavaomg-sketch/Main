'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@techmatch/database';
import { applyImport, createImportJob, dryRunImport, setImportMapping, type ImportOptions } from '@techmatch/domain';
import type { CanonicalField } from '@techmatch/integrations';
import { requireAdmin } from '@/lib/admin';
import { runAction, toActionError, type ActionResult } from '@/lib/errors';

export async function uploadImportAction(_prev: ActionResult<undefined> | null, formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('imports.write');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Выберите файл CSV, XLSX или YML' };
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: 'Файл больше 20 МБ' };
  let jobId: string;
  try {
    const job = await createImportJob(prisma, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type, sourceCode: String(formData.get('sourceCode') ?? '') || null, adminId: admin.id });
    jobId = job.id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/admin/imports/${jobId}`);
}

export async function setMappingAction(jobId: string, formData: FormData): Promise<ActionResult<undefined>> {
  await requireAdmin('imports.write');
  return runAction(async () => {
    const mapping: Record<string, CanonicalField | ''> = {};
    for (const [k, v] of formData.entries()) if (k.startsWith('map:')) mapping[k.slice(4)] = String(v) as CanonicalField | '';
    const options: Partial<ImportOptions> = {
      sourceOwnedFields: formData.getAll('owned').map(String) as ImportOptions['sourceOwnedFields'],
      createMissing: formData.get('createMissing') === 'on',
      activateCreated: formData.get('activateCreated') === 'on',
      downloadImages: formData.get('downloadImages') === 'on',
    };
    await setImportMapping(prisma, jobId, mapping, options);
    await dryRunImport(prisma, jobId);
    revalidatePath(`/admin/imports/${jobId}`);
    return undefined;
  });
}

export async function applyImportAction(jobId: string): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('imports.write');
  return runAction(async () => {
    await applyImport(prisma, jobId, admin.id);
    revalidatePath('/', 'layout');
    return undefined;
  });
}

export async function rerunDryRunAction(jobId: string): Promise<ActionResult<undefined>> {
  await requireAdmin('imports.write');
  return runAction(async () => {
    await prisma.importJob.update({ where: { id: jobId }, data: { status: 'MAPPED' } });
    await dryRunImport(prisma, jobId);
    revalidatePath(`/admin/imports/${jobId}`);
    return undefined;
  });
}
