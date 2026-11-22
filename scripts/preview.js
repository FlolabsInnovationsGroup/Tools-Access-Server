import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createPortal } from '../lib/portal.js';
import { localStore, setupLocal } from './local-store.js';

const root = new URL('../public/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
]);
const port = Number(process.env.PORT || 3000);
const handle = createPortal({ store: localStore, secure: false });
await setupLocal();

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/api/portal') {
    try {
      const message = new Request(url, {
        method: request.method,
        headers: request.headers,
        ...(request.method === 'POST' && { body: Readable.toWeb(request), duplex: 'half' }),
      });
      const output = await handle(message);
      response.writeHead(output.status, Object.fromEntries(output.headers)).end(await output.text());
    } catch {
      response.writeHead(500).end('The portal request could not be handled.');
    }
    return;
  }
  const entry = files.get(url.pathname);
  if (!entry || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const [file, contentType] = entry;
    const body = await readFile(new URL(file, root));
    response.writeHead(200, {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(500).end('Preview file could not be loaded');
  }
}).listen(port, '127.0.0.1', () => console.log(`FloLabs Access at http://127.0.0.1:${port}`));
