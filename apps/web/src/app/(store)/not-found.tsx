import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty';
import { SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="shell py-12">
      <EmptyState icon={<SearchX width={26} height={26} />} title="Страница не найдена" text="Возможно, товар снят с продажи или ссылка устарела." action={<Link href="/" className="btn btn-primary">На главную</Link>} />
    </div>
  );
}
