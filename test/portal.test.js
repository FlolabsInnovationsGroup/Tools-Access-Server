import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPortal, provisionAdmin } from '../lib/portal.js';
import { day, fileStore } from '../lib/portal-store.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'flolabs-portal-test-'));
  const path = join(directory, 'portal.json');
  t.after(async () => {
    await rm(path, { force: true });
    await rmdir(directory);
  });
  const store = fileStore(path);
  let now = Date.now();
  const admin = await provisionAdmin(store);
  const clock = () => now;
  let handle = createPortal({ store, clock });
  const request = async (action, cookie = '', fields = {}, origin) => {
    const headers = { cookie, ...(origin && { origin }) };
    const response = await handle(new Request('https://access.example.test/api/portal', action ? {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...fields }),
    } : { headers }));
    const setCookie = response.headers.get('set-cookie');
    return { status: response.status, result: await response.json(), setCookie, cookie: setCookie?.split(';', 1)[0] };
  };
  return {
    admin, path, request, setTime: (value) => { now = value; },
    restart: () => { handle = createPortal({ store: fileStore(path), clock }); },
  };
}

test('real accounts, sessions and reviewed requests persist across new handler instances', async (t) => {
  const { admin, path, request, restart } = await fixture(t);
  assert.equal((await request('add-member', '', { username: 'member' })).status, 401);
  const adminSession = await request('sign-in', '', admin);
  assert.match(adminSession.setCookie, /^__Host-/);
  assert.match(adminSession.setCookie, /HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  const owner = adminSession.cookie;
  assert.equal((await request('add-member', owner, { username: 'member' }, 'https://unrelated.example.test')).status, 403);
  const created = await request('add-member', owner, { username: 'Member' });
  assert.equal(created.status, 200);
  const { username, password } = created.result;
  assert.equal(username, 'member');
  assert.equal(password.length, 24);
  assert.equal((await request('add-member', owner, { username })).status, 409);

  const stored = await readFile(path, 'utf8');
  assert.ok(!stored.includes(password));
  assert.ok(!stored.includes(owner.split('=')[1]));
  restart();
  assert.equal((await request(null, owner)).result.members.length, 2);
  assert.equal((await request('sign-in', '', { username, password: 'wrong' })).status, 401);
  const first = (await request('sign-in', '', { username, password })).cookie;
  const second = (await request('sign-in', '', { username, password })).cookie;
  assert.notEqual(first, second);
  assert.equal((await request(null, first)).result.members.length, 0);
  assert.equal((await request('add-member', first, { username: 'other' })).status, 403);

  const [one, duplicate] = await Promise.all([request('request-access', first), request('request-access', second)]);
  assert.equal(one.result.state.user.status, 'Pending');
  assert.equal(duplicate.result.state.user.requests, 1);
  const pending = (await request(null, owner)).result.members.find((member) => member.username === username);
  assert.equal(pending.history[0].type, 'Access requested');
  const approved = await request('review-request', owner, { username, decision: 'approve' });
  assert.equal(approved.result.state.members.find((member) => member.username === username).status, 'Approved');
  assert.equal((await request('request-access', second)).result.state.user.requests, 1);
  await request('sign-out', first);
  assert.equal((await request(null, first)).result.user, null);
  assert.equal((await request(null, second)).result.user.status, 'Approved');
  await request('set-active', owner, { username, active: false });
  assert.equal((await request(null, second)).result.user, null);
});

test('a scheduled cycle boundary expires all sessions but keeps accounts and history', async (t) => {
  const { admin, path, request, setTime } = await fixture(t);
  const owner = (await request('sign-in', '', admin)).cookie;
  const { result: credentials } = await request('add-member', owner, { username: 'member' });
  const { cookie: member } = await request('sign-in', '', credentials);
  await request('request-access', member);
  const { result } = await request('set-cadence', owner, { days: 3 });
  setTime(result.state.ends + day);
  assert.equal((await request(null, member)).result.user, null);
  assert.equal((await request(null, owner)).result.user, null);
  const signedIn = await request('sign-in', '', credentials);
  assert.equal(signedIn.result.state.days, 3);
  assert.equal(signedIn.result.state.user.status, 'Eligible');
  assert.equal((await request('request-access', signedIn.cookie)).result.state.user.requests, 1);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.users.find(({ username }) => username === 'member').history.length, 2);
});
