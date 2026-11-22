import { provisionAdmin } from '../lib/portal.js';
import { blobStore } from '../lib/portal-store.js';
import { setupLocal } from './local-store.js';

const args = process.argv.slice(2);
const username = args.find((value) => value !== '--blob') ?? 'admin';

try {
  if (args.includes('--blob')) {
    const admin = await provisionAdmin(blobStore(process.env.BLOB_READ_WRITE_TOKEN), username);
    if (admin) console.log(`Username: ${admin.username}\nPassword: ${admin.password}`);
    else console.log('The private Blob store already has an administrator.');
  } else if (!await setupLocal(username)) {
    console.log('The local portal already has an administrator.');
  }
} catch (error) {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
}
