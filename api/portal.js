import { createPortal } from '../lib/portal.js';
import { blobStore } from '../lib/portal-store.js';

let handle;

export default {
  fetch(request) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return Response.json({ error: 'The private portal store is not configured.' }, {
        status: 503, headers: { 'Cache-Control': 'no-store' },
      });
    }
    handle ??= createPortal({ store: blobStore(token) });
    return handle(request);
  },
};
