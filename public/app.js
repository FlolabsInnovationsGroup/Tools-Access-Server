const $ = (id) => document.getElementById(id);
const day = 86_400_000;
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
});
const date = (value) => `${dateFormat.format(value)} PKT`;
let state;
let selectedUsername;
let view = 'login';
let busy = false;
let revision = 0;

function text(id, value) {
  $(id).textContent = value;
}

function feedback(id, message = '') {
  text(id, message);
  $(id).hidden = !message;
}

async function portal(action, data = {}) {
  const response = await fetch('/api/portal', action ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }),
  } : { cache: 'no-store' });
  const content = await response.json();
  if (!response.ok) {
    const error = new Error(content.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return content;
}

function showView(next) {
  $('admin-panel').hidden = next !== 'admin';
  $('access-shell').hidden = next === 'admin';
  $('login-panel').hidden = next !== 'login';
  $('member-panel').hidden = next !== 'member';
  $('sign-out').hidden = next === 'login';
  if (next !== view) {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    if (next === 'login') $('login-form').reset();
    (next === 'admin' ? $('admin-heading') : $(`${next}-panel`).querySelector('h2')).focus();
    view = next;
  }
}

function renderCycle() {
  const { started, ends, days, nextDays } = state;
  const currentDay = Math.max(1, Math.min(days, Math.floor((Date.now() - started) / day) + 1));
  text('cycle-day', `Day ${currentDay} of ${days}`);
  $('cycle-track').replaceChildren(...Array.from({ length: days }, (_, index) => {
    const tick = document.createElement('i');
    if (index < currentDay) tick.className = index === currentDay - 1 ? 'today' : 'passed';
    return tick;
  }));
  text('cycle-end', date(ends));
  $('cycle-end').dateTime = new Date(ends).toISOString();
  text('admin-cycle-label', `Every ${days} days · Resets ${date(ends)}${nextDays === days ? '' : ` · Next cycle ${nextDays} days`}`);
}

function renderMember() {
  const { user, ends } = state;
  const descriptions = {
    Eligible: 'Request access for your workspace admin to review.',
    Pending: 'Your request is waiting for a workspace admin to review it.',
    Approved: `Your workspace admin approved your request through ${date(ends)}.`,
    Declined: 'Your workspace admin declined this request. You can submit another request during this cycle.',
  };
  text('member-name', user.name);
  text('member-status', user.status);
  text('member-intro', descriptions[user.status]);
  $('request-access').hidden = user.status === 'Pending' || user.status === 'Approved';
}

function makeRow(member) {
  const row = document.createElement('tr');
  const nameCell = row.insertCell();
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'person-link';
  action.dataset.username = member.username;
  action.addEventListener('click', () => openPerson(member.username));
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = member.name.split(/\s+/).slice(0, 2).map((word) => word[0].toUpperCase()).join('');
  const label = document.createElement('span');
  label.className = 'person-name';
  label.textContent = member.name;
  const username = document.createElement('small');
  username.textContent = `@${member.username}${member.role === 'Admin' ? ' · Admin' : ''}`;
  label.append(username);
  action.append(avatar, label);
  nameCell.append(action);

  const status = document.createElement('span');
  status.className = 'account-status';
  status.dataset.status = member.status;
  status.textContent = member.status;
  row.insertCell().append(status);
  row.insertCell().textContent = member.requests;
  row.insertCell().textContent = member.lastRequest === null ? '—' : date(member.lastRequest);
  return row;
}

function renderPeople() {
  const { members } = state;
  const search = $('search').value.trim().toLowerCase();
  const filter = $('filter').value;
  const focusedUsername = document.activeElement?.dataset.username;
  const visible = members.filter((member) => `${member.name} ${member.username}`.toLowerCase().includes(search)
    && (!filter || member.status === filter));
  $('people-rows').replaceChildren(...visible.map(makeRow));
  if (focusedUsername) focusMember(focusedUsername);
  $('no-results').hidden = visible.length > 0;
  text('metric-people', members.filter(({ active }) => active).length);
  text('metric-requests', members.reduce((total, member) => total + member.requests, 0));
  text('metric-grants', members.filter(({ status }) => status === 'Approved').length);
}

function focusMember(username) {
  const button = [...$('people-rows').querySelectorAll('.person-link')].find((row) => row.dataset.username === username);
  (button ?? $('search')).focus();
}

function openPerson(username) {
  selectedUsername = username;
  feedback('person-error');
  renderPerson();
  $('person-dialog').showModal();
}

function renderPerson() {
  const member = state.members.find((user) => user.username === selectedUsername);
  if (!member) return;
  text('person-title', member.name);
  text('person-info', `@${member.username} · ${member.status}`);
  const activity = [...member.history].reverse();
  $('person-activity').replaceChildren(...(activity.length ? activity : [{ type: 'No activity this cycle' }]).map((event) => {
    const item = document.createElement('li');
    item.textContent = event.type;
    if (event.time !== undefined) {
      const time = document.createElement('time');
      time.dateTime = new Date(event.time).toISOString();
      time.textContent = date(event.time);
      item.append(time);
    }
    return item;
  }));
  $('review-actions').hidden = member.status !== 'Pending';
  $('toggle-access').hidden = member.role === 'Admin';
  text('toggle-access', member.active ? 'Disable account' : 'Enable account');
}

function applyState(next) {
  const signedOut = Boolean(state?.user && !next.user);
  const newCycle = state && next.started !== state.started;
  state = next;
  renderCycle();
  showView(state.user?.role === 'Admin' ? 'admin' : state.user ? 'member' : 'login');
  if (view === 'admin') {
    renderPeople();
    if ($('person-dialog').open) renderPerson();
  } else if (view === 'member') renderMember();
  else if (signedOut && newCycle) feedback('login-status', 'A new access cycle has started. Sign in to continue.');
  else if (signedOut) feedback('login-status', 'You are signed out.');
}

async function refresh() {
  if (busy) return;
  const current = ++revision;
  try {
    const result = await portal();
    if (current === revision) {
      feedback('portal-error');
      applyState(result);
    }
  } catch {
    if (current === revision) feedback('portal-error', 'Could not reach the portal. Refresh the page to try again.');
  }
}

async function run(button, action, values, errorId, onSuccess) {
  if (busy) return;
  busy = true;
  revision += 1;
  button.disabled = true;
  feedback(errorId);
  try {
    const result = await portal(action, values);
    feedback('portal-error');
    applyState(result.state);
    onSuccess?.(result);
  } catch (error) {
    feedback(errorId, error.message);
    if (error.status === 401 && action !== 'sign-in') {
      busy = false;
      await refresh();
    }
  } finally {
    busy = false;
    button.disabled = false;
  }
}

$('login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  feedback('login-status');
  run(event.submitter, 'sign-in', Object.fromEntries(new FormData(event.currentTarget)), 'login-error', () => {
    $('password').value = '';
    if ($('password').type === 'text') $('show-password').click();
  });
});

$('show-password').addEventListener('click', () => {
  const visible = $('password').type === 'password';
  $('password').type = visible ? 'text' : 'password';
  $('show-password').setAttribute('aria-pressed', String(visible));
  text('show-password', visible ? 'Hide' : 'Show');
});

$('sign-out').addEventListener('click', (event) => run(event.currentTarget, 'sign-out', {}, 'portal-error'));
$('request-access').addEventListener('click', (event) => run(event.currentTarget, 'request-access', {}, 'request-error', () => {
  $('member-panel').querySelector('h2').focus();
}));
$('search').addEventListener('input', renderPeople);
$('filter').addEventListener('change', renderPeople);

$('add-person').addEventListener('click', () => {
  $('add-form').reset();
  $('add-form').hidden = false;
  $('created-account').hidden = true;
  feedback('add-error');
  feedback('copy-feedback');
  text('add-title', 'Add a person');
  $('add-dialog').showModal();
  $('new-username').focus();
});

$('add-form').addEventListener('submit', (event) => {
  event.preventDefault();
  run(event.submitter, 'add-member', Object.fromEntries(new FormData(event.currentTarget)), 'add-error', ({ username, password }) => {
    $('add-form').hidden = true;
    $('created-account').hidden = false;
    text('add-title', 'Account created');
    text('created-info', 'Share these login details privately. The generated password is shown once.');
    $('generated-username').value = username;
    $('generated-password').value = password;
    $('copy-password').focus();
  });
});

$('add-dialog').addEventListener('close', () => {
  $('generated-username').value = '';
  $('generated-password').value = '';
});
$('copy-password').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(`Username: ${$('generated-username').value}\nPassword: ${$('generated-password').value}`);
    feedback('copy-feedback', 'Login details copied.');
  } catch {
    $('generated-password').select();
    feedback('copy-feedback', 'Password selected for manual copying.');
  }
});

for (const [button, decision] of [['approve-request', 'approve'], ['decline-request', 'decline']]) {
  $(button).addEventListener('click', (event) => run(event.currentTarget, 'review-request', {
    username: selectedUsername, decision,
  }, 'person-error', () => $('toggle-access').focus()));
}
$('toggle-access').addEventListener('click', (event) => {
  const member = state.members.find((user) => user.username === selectedUsername);
  run(event.currentTarget, 'set-active', { username: member.username, active: !member.active }, 'person-error');
});
$('person-dialog').addEventListener('close', () => { if (view === 'admin') focusMember(selectedUsername); });

$('cycle-settings').addEventListener('click', () => {
  $('cadence').value = state.nextDays;
  feedback('cadence-feedback');
  feedback('cadence-error');
  $('cycle-dialog').showModal();
});
$('cadence-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const days = Number($('cadence').value);
  run(event.submitter, 'set-cadence', { days }, 'cadence-error', () => {
    feedback('cadence-feedback', `Saved. The next cycle will run for ${days} days.`);
  });
});
$('reset-cycle').addEventListener('click', (event) => run(event.currentTarget, 'reset-cycle', {}, 'cadence-error'));

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}
refresh();
window.addEventListener('focus', refresh);
setInterval(() => { if (!document.hidden && state?.user) refresh(); }, 30_000);
