# FloLabs Access portal

The portal manages FloLabs accounts and access requests. Admins create usernames and the server generates passwords. Members sign in, request access, and see the admin’s approval or decline. Each member can have one pending request or approved request per cycle. The portal authenticates its own accounts and records its own approvals.

## Run locally

```powershell
npm ci
npm start
```

Open `http://127.0.0.1:3000`. On first start, the server creates the `admin` account and writes its login details to `.portal/admin-login.txt`. Copy the credentials into your password manager. Account records, sessions, and request history persist in `.portal/portal.json`. Both files are private to the checkout and excluded from Git and deployment. Run one server process against the local store.

The administrator can add a member with a username and an optional display name. The creation dialog shows the password once. A member can sign in with the same credentials on different browsers or devices when they use the same deployed portal. Disabling a member revokes that member’s active sessions. A cycle reset revokes everyone’s sessions and starts a new request cycle while retaining account records.

## Deploy the serverless version

1. Connect the repository to a Vercel project and create a **private** Vercel Blob store. Vercel supplies `BLOB_READ_WRITE_TOKEN` to the function. Give each environment its own private store. [Private Blob storage](https://vercel.com/docs/vercel-blob/private-storage)
2. Supply that same token to `.env.local` or the shell for the one-time setup command below. Save the generated credentials privately.
3. Deploy the project. The static frontend is served from `public/`. The `/api/portal` Vercel Function serves the authenticated state and handles changes. The deployed site uses HTTPS and secure session cookies. [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)

```powershell
npm run setup -- --blob admin
```

The server stores salted scrypt password hashes and hashes of opaque session tokens. The private Blob update compares its ETag before writing, so concurrent updates can’t silently overwrite each other. Request activity is bounded to the most recent 200 events per member and is pruned after 90 days at a cycle boundary. The admin panel shows current-cycle activity. [Consistent private reads](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage) · [Conditional Blob writes](https://vercel.com/docs/vercel-blob#conditional-writes)

Vercel Hobby lists 1 GB of Blob storage, 10,000 simple operations, and 2,000 advanced operations included. Hobby is limited to personal or non-commercial use. FloLabs should use its applicable Vercel plan and check plan usage before deployment. [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) · [Vercel terms](https://vercel.com/legal/terms)

## Portal API

`GET /api/portal` returns the current cycle, signed-in member, and roster when the session belongs to an admin.

`POST /api/portal` accepts a JSON body with an `action`.

| Action | Parameters | Result |
| --- | --- | --- |
| `sign-in` | `username`, `password` | Start a session and return the portal state. |
| `sign-out` | None | Revoke this session. |
| `request-access` | None | Record a member’s request. Repeating a pending or approved request leaves its count unchanged. |
| `add-member` | `username`, optional `name` | Create a member and return the generated password once. |
| `review-request` | `username`, `decision` of `approve` or `decline` | Update a pending request. |
| `set-active` | `username`, `active` | Enable or disable a member. |
| `set-cadence` | `days` of `3` or `7` | Schedule a cadence change at the next boundary. |
| `reset-cycle` | None | End the current cycle and revoke all sessions. |

## Verification and design tools

`npm test` checks generated credentials, sessions on two devices, role enforcement, concurrent requests, approvals, and automatic cycle expiry against an isolated file store.

These optional UI design tools are installed locally in the `Tools-Access-Server` checkout. They are independent of the portal runtime.

```powershell
claude plugin install unslop --marketplace heydamir/unslop --scope local
npx --yes skills add https://github.com/emilkowalski/skills --skill apple-design --agent codex --yes
```
