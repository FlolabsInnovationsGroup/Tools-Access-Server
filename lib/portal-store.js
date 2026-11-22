import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const day = 86_400_000;

export function emptyPortal(now = Date.now()) {
  return { cycle: { started: now, days: 7, nextDays: 7 }, users: [], sessions: [] };
}

export function fileStore(path) {
  let queue = Promise.resolve();

  async function read() {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return emptyPortal();
    }
  }

  return {
    read,
    update(change) {
      const work = queue.then(async () => {
        const state = await read();
        const previous = JSON.stringify(state);
        const result = await change(state);
        const next = JSON.stringify(state);
        if (next === previous) return result;
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const temp = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temp, next, { mode: 0o600 });
          await rename(temp, path);
        } finally {
          await rm(temp, { force: true });
        }
        return result;
      });
      queue = work.catch(() => {});
      return work;
    },
  };
}

export function blobStore(token) {
  if (!token) throw new Error('A private Blob read/write token is required.');
  const path = 'flolabs-access/portal.json';
  const sdk = import('@vercel/blob');
  const options = { access: 'private', token };

  async function readVersion() {
    const { get } = await sdk;
    const file = await get(path, { ...options, useCache: false });
    if (!file) return { state: emptyPortal() };
    return { state: await new Response(file.stream).json(), etag: file.blob.etag };
  }

  return {
    async read() { return (await readVersion()).state; },
    async update(change) {
      const { put, BlobPreconditionFailedError } = await sdk;
      for (let attempt = 0; attempt < 4; attempt++) {
        const { state, etag } = await readVersion();
        const previous = JSON.stringify(state);
        const result = await change(state);
        const next = JSON.stringify(state);
        if (next === previous) return result;
        try {
          await put(path, next, {
            ...options,
            contentType: 'application/json',
            allowOverwrite: Boolean(etag),
            ...(etag && { ifMatch: etag }),
          });
          return result;
        } catch (error) {
          const conflict = error instanceof BlobPreconditionFailedError || (!etag && (await readVersion()).etag);
          if (!conflict) throw error;
        }
      }
      throw new Error('The portal state changed repeatedly. Try again.');
    },
  };
}
