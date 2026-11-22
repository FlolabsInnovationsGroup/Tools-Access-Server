import { createAccount, digest, passwordMatches, secret, usernamePattern } from './portal-auth.js';
import { day } from './portal-store.js';

const loginWindow = 15 * 60_000;
const requestCooldown = 30_000;
const historyAge = 90 * day;
const maxHistory = 200;
const jsonHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const clean = (value) => typeof value === 'string' ? value.trim() : '';
const fail = (status, error) => ({ status, error });
const cycleEnd = ({ cycle }) => cycle.started + cycle.days * day;

function beginCycle(state, started) {
  state.cycle.started = started;
  state.cycle.days = state.cycle.nextDays;
  state.sessions = [];
  for (const user of state.users) user.history = user.history.filter(({ time }) => time >= started - historyAge);
}

function advanceCycle(state, time) {
  const end = cycleEnd(state);
  if (time >= end) {
    const nextLength = state.cycle.nextDays * day;
    beginCycle(state, end + Math.floor((time - end) / nextLength) * nextLength);
  }
}

function publicUser(user, cycle, showHistory = false) {
  const activity = user.history.filter((entry) => entry.cycle === cycle);
  const last = activity.at(-1)?.type;
  let status = 'Eligible';
  if (last === 'Access requested') status = 'Pending';
  if (last === 'Access approved') status = 'Approved';
  if (last === 'Access declined') status = 'Declined';
  if (!user.active) status = 'Disabled';
  const requests = activity.filter(({ type }) => type === 'Access requested');
  return {
    username: user.username, name: user.name, role: user.role, active: user.active,
    status, requests: requests.length, lastRequest: requests.at(-1)?.time ?? null,
    ...(showHistory && { history: activity.map(({ type, time }) => ({ type, time })) }),
  };
}

function viewer(state, token, time) {
  if (!/^[\w-]{43}$/.test(token)) return null;
  const session = state.sessions.find((entry) => entry.hash === digest(token) && entry.expires > time);
  return session ? state.users.find((user) => user.username === session.username && user.active) ?? null : null;
}

function snapshot(state, token, time) {
  const user = viewer(state, token, time);
  const cycle = state.cycle.started;
  return {
    ...state.cycle,
    ends: cycleEnd(state),
    user: user ? publicUser(user, cycle) : null,
    members: user?.role === 'Admin' ? state.users.map((member) => publicUser(member, cycle, true)) : [],
  };
}

export async function provisionAdmin(store, username = 'admin') {
  username = clean(username).toLowerCase();
  if (!usernamePattern.test(username)) throw new Error('Use a 2–40 character username.');
  return store.update(async (state) => {
    if (state.users.some(({ role }) => role === 'Admin')) return null;
    if (state.users.some((user) => user.username === username)) throw new Error('That username is in use.');
    const { user, password } = await createAccount(username, 'Workspace admin', 'Admin');
    state.users.push(user);
    return { username, password };
  });
}

async function startSession(state, data, time) {
  const username = clean(data.username).toLowerCase();
  const password = typeof data.password === 'string' ? data.password : '';
  if (!usernamePattern.test(username) || !password || password.length > 256) {
    return fail(401, 'The username or password is incorrect.');
  }
  const member = state.users.find((user) => user.username === username && user.active);
  const attempts = member?.loginAttempts;
  const count = attempts?.until > time ? attempts.count : 0;
  if (count >= 10) return fail(429, 'Too many sign-in attempts. Try again in 15 minutes.');
  const valid = await passwordMatches(password, member?.credential);
  if (!member || !valid) {
    if (member) member.loginAttempts = { count: count + 1, until: count ? attempts.until : time + loginWindow };
    return fail(401, 'The username or password is incorrect.');
  }
  delete member.loginAttempts;
  const token = secret();
  const expires = cycleEnd(state);
  const active = state.sessions.filter((session) => session.expires > time);
  const previous = active.filter((session) => session.username === username).slice(-9);
  state.sessions = active.filter((session) => session.username !== username).concat(previous, { username, hash: digest(token), expires });
  return { token, expires };
}

function record(state, user, type, time) {
  user.history.push({ type, time, cycle: state.cycle.started });
  if (user.history.length > maxHistory) user.history.shift();
}

function requestAccess(state, user, time) {
  if (user.role !== 'Member') return fail(403, 'Only member accounts can request access.');
  const current = publicUser(user, state.cycle.started);
  if (current.status === 'Pending' || current.status === 'Approved') return {};
  if (current.requests >= 20) return fail(429, 'This account reached the request limit for the current cycle.');
  if (current.lastRequest !== null && time < current.lastRequest + requestCooldown) {
    return fail(429, 'Wait 30 seconds before requesting access again.');
  }
  record(state, user, 'Access requested', time);
  return {};
}

async function adminAction(action, state, data, time) {
  if (action === 'add-member') {
    const username = clean(data.username).toLowerCase();
    const name = clean(data.name) || username;
    if (!usernamePattern.test(username) || name.length > 100) return fail(400, 'Enter a valid username and a name of up to 100 characters.');
    if (state.users.length >= 200) return fail(409, 'The portal reached its account limit.');
    if (state.users.some((user) => user.username === username)) return fail(409, 'That username is already in use.');
    const { user, password } = await createAccount(username, name, 'Member');
    state.users.push(user);
    return { extra: { username, password } };
  }

  if (action === 'set-cadence') {
    if (![3, 7].includes(data.days)) return fail(400, 'Choose a 3- or 7-day cycle.');
    state.cycle.nextDays = data.days;
    return {};
  }

  if (action === 'reset-cycle') {
    beginCycle(state, Math.max(time, state.cycle.started + 1));
    return { token: '', expires: 0 };
  }

  const member = state.users.find((user) => user.username === data.username && user.role === 'Member');
  if (!member) return fail(404, 'Member account not found.');
  if (action === 'set-active') {
    if (typeof data.active !== 'boolean') return fail(400, 'Choose whether the account is active.');
    member.active = data.active;
    if (!member.active) state.sessions = state.sessions.filter((session) => session.username !== member.username);
    return {};
  }

  if (action === 'review-request') {
    if (!['approve', 'decline'].includes(data.decision)) return fail(400, 'Choose approve or decline.');
    if (publicUser(member, state.cycle.started).status !== 'Pending') return fail(409, 'This request is no longer pending.');
    record(state, member, data.decision === 'approve' ? 'Access approved' : 'Access declined', time);
    return {};
  }

  return fail(404, 'Unknown portal action.');
}

export function createPortal({ store, secure = true, clock = Date.now }) {
  const cookieName = secure ? '__Host-flolabs-session' : 'flolabs-session';
  const readToken = (request) => request.headers.get('cookie')?.split(';').map((field) => field.trim())
    .find((field) => field.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';

  return async function handle(request) {
    const send = (body, status = 200, cookie) => Response.json(body, {
      status, headers: { ...jsonHeaders, ...(cookie && { 'Set-Cookie': cookie }) },
    });
    const token = readToken(request);
    try {
      if (request.method === 'GET') {
        const state = await store.read();
        const time = clock();
        advanceCycle(state, time);
        return send(snapshot(state, token, time));
      }
      if (request.method !== 'POST') return send({ error: 'Method not supported.' }, 405);
      const origin = request.headers.get('origin');
      if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
        return send({ error: 'Open this action from the FloLabs portal.' }, 403);
      }
      if (!request.headers.get('content-type')?.startsWith('application/json')) return send({ error: 'Send a JSON request.' }, 415);
      const raw = await request.text();
      if (raw.length > 4096) return send({ error: 'This request is too large.' }, 413);
      let data;
      try { data = JSON.parse(raw); } catch { return send({ error: 'Invalid JSON request.' }, 400); }
      if (typeof data?.action !== 'string') return send({ error: 'Choose a portal action.' }, 400);

      const result = await store.update(async (state) => {
        const time = clock();
        advanceCycle(state, time);
        const user = viewer(state, token, time);
        let output;
        if (data.action === 'sign-in') output = await startSession(state, data, time);
        else if (data.action === 'sign-out') {
          if (user) state.sessions = state.sessions.filter((session) => session.hash !== digest(token));
          output = { token: '', expires: 0 };
        } else if (!user) output = fail(401, 'Sign in to continue.');
        else if (data.action === 'request-access') output = requestAccess(state, user, time);
        else if (user.role !== 'Admin') output = fail(403, 'Admin access is required.');
        else output = await adminAction(data.action, state, data, time);
        if (output.error) return output;
        return { ...output, state: snapshot(state, output.token ?? token, time) };
      });
      if (result.error) return send({ error: result.error }, result.status);
      let cookie;
      if (result.token !== undefined) {
        const maxAge = Math.max(0, Math.ceil((result.expires - clock()) / 1000));
        cookie = `${cookieName}=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
      }
      return send({ state: result.state, ...result.extra }, 200, cookie);
    } catch {
      return send({ error: 'Portal storage is unavailable. Try again in a moment.' }, 503);
    }
  };
}
