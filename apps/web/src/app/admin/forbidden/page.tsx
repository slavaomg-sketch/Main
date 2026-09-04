import Link from 'next/link';

export default function Forbidden() {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <h1 className="h2 mb-2">Недостаточно прав</h1>
      <p className="mb-4 text-[13px] text-ink-600">Ваша роль не позволяет открыть этот раздел. Обратитесь к владельцу магазина.</p>
      <Link href="/admin" className="btn btn-outline">На дашборд</Link>
    </div>
  );
}
