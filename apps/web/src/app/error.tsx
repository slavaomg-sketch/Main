'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="h2 mb-2">Что-то пошло не так</h1>
      <p className="mb-5 text-[14px] text-ink-600">Мы уже знаем о проблеме. Попробуйте обновить страницу.</p>
      <button type="button" className="btn btn-primary" onClick={() => reset()}>Попробовать снова</button>
    </div>
  );
}
