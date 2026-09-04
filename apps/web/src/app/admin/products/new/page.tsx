import { prisma } from '@techmatch/database';
import { requireAdmin } from '@/lib/admin';
import { AdminPage } from '@/components/admin/ui';
import { ProductForm } from '@/components/admin/product-form';

export default async function NewProductPage() {
  await requireAdmin('products.write');
  const [brands, categories] = await Promise.all([prisma.productBrand.findMany({ orderBy: { name: 'asc' } }), prisma.accessoryCategory.findMany({ orderBy: { sortOrder: 'asc' } })]);
  return (
    <AdminPage title="Новый товар" description="После создания добавьте варианты с ценой и остатком, характеристики и изображения">
      <ProductForm product={{ id: null, name: '', slug: '', brandId: '', categoryId: categories[0]?.id ?? '', status: 'DRAFT', shortDescription: '', description: '', badges: [], packageContents: [], warrantyMonths: 12, isFeatured: false, isNew: false, seoTitle: '', seoDescription: '', weightGrams: null }} brands={brands} categories={categories} />
    </AdminPage>
  );
}
