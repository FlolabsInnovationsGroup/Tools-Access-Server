import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { provisionAdmin } from '../lib/portal.js';
import { fileStore } from '../lib/portal-store.js';

const localData = new URL('../.portal/portal.json', import.meta.url);
const loginFile = new URL('../.portal/admin-login.txt', import.meta.url);
export const localStore = fileStore(fileURLToPath(localData));

export async function setupLocal(username) {
  const admin = await provisionAdmin(localStore, username);
  if (!admin) return false;
  await writeFile(loginFile, `Username: ${admin.username}\nPassword: ${admin.password}\n`, { mode: 0o600 });
  console.log(`Local admin credentials saved to ${fileURLToPath(loginFile)}`);
  return true;
}
