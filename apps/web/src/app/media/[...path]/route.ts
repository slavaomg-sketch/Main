import { readFile, stat } from 'node:fs/promises';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveLocalMediaPath } from '@techmatch/domain';

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif' };

/** Раздача локального хранилища медиа (MEDIA_DRIVER=local). В production перед Node лучше поставить nginx. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const key = path.join('/');
  if (key.includes('..')) return new NextResponse('Not found', { status: 404 });
  try {
    const file = resolveLocalMediaPath(key);
    const info = await stat(file);
    const data = await readFile(file);
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    return new NextResponse(new Uint8Array(data), {
      headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Length': String(info.size), 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
