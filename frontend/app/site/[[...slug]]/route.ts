import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-static';

async function storefrontHtml(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), 'public', 'site', 'index.html'),
    path.join(process.cwd(), 'frontend', 'public', 'site', 'index.html'),
  ];
  let lastErr: unknown;
  for (const filePath of candidates) {
    try {
      return await readFile(filePath, 'utf8');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function GET() {
  try {
    const html = await storefrontHtml();
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch {
    return new Response('Storefront is unavailable.', { status: 404 });
  }
}
