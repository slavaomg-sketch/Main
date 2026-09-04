import { NextResponse, type NextRequest } from 'next/server';

/**
 * Защита административных маршрутов на уровне edge: без cookie сессии администратора
 * к /admin/* нет доступа (проверка самой сессии — в requireAdmin на сервере).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    if (!req.cookies.get('tm_admin')?.value) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }
  if (pathname.startsWith('/api/admin') && !req.cookies.get('tm_admin')?.value) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const res = NextResponse.next({ request: { headers: new Headers({ ...Object.fromEntries(req.headers), 'x-pathname': pathname }) } });
  return res;
}

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };
