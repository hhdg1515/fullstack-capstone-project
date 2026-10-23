# GiftLink — Identity & Access Foundation

GiftLink remains a React, Express, Node.js, and MongoDB native-driver application. Milestone 1 adds revocable authentication sessions and account management while preserving public gift browsing/search and all 16 bundled demo records. Move-out plans, bulk management, pickup coordination, messaging, and geographical APIs are not implemented.

## Requirements

- Node.js 22 and npm.
- Docker for local MongoDB and isolated backend tests.
- No IBM Skills Network account, Kubernetes cluster, or original course database is needed.

## Local setup

From the repository root:

```bash
npm --prefix giftlink-backend ci
npm --prefix giftlink-frontend ci
```

Start a local development MongoDB, preserving its data in a named volume:

```bash
docker run --detach --name giftlink-mongo \
  --publish 127.0.0.1:27017:27017 \
  --mount source=giftlink-mongo-data,target=/data/db \
  mongo:8.0
```

Reuse `docker start giftlink-mongo` if this is your existing development container. Verify its identity, port, and mount before reusing it. Do not replace an unrelated service occupying the port. Tests never use this container or volume.

Copy local configuration without replacing existing files:

```bash
cp -n giftlink-backend/.env.sample giftlink-backend/.env
cp -n giftlink-frontend/.env.sample giftlink-frontend/.env.local
```

Backend example:

```dotenv
MONGO_URL=mongodb://127.0.0.1:27017
MONGO_DB_NAME=giftdb
DB_ENVIRONMENT=development
APP_ORIGIN=http://localhost:3000
SESSION_TTL_SECONDS=28800
PORT=3060
```

Frontend development example:

```dotenv
REACT_APP_BACKEND_URL=http://localhost:3060
```

Open the React application using `http://localhost:3000`. If using `127.0.0.1` instead, use it consistently for the browser, `APP_ORIGIN`, and frontend backend URL. Do not mix hostnames: cookies are host-scoped. Actual `.env` files are ignored; process settings override dotenv values. Frontend values are read at startup/build time.

### Prepare identity indexes explicitly

Database initialization is separate from demo seeding. **Verify the provider project/service, cluster/endpoints, database, and environment before approving any index creation.** The tool cannot identify your provider account or decide which cluster is intended.

For the example local target, preview first:

```bash
cd giftlink-backend
npm run db:prepare -- --dry-run
```

Omitting flags also means dry-run. The preview connects read-only, checks the selected database and MongoDB topology using `hello`, then reports:

- The explicit environment/database, credential-free endpoints, topology type, and a full SHA-256 target fingerprint.
- `create` or `keep` for each required index, and any incompatible existing definitions.
- Counts of invalid/missing, non-normalized, and duplicate normalized emails. Duplicate counts include collisions after trimming/lowercasing. No emails, hashes, account IDs, URI credentials, or raw server errors are printed.

No collections, indexes, accounts, sessions, or demo gifts are created by a preview. Conflicts produce a nonzero exit after the safe report. Review the target against your local service or provider console, then explicitly approve the **full fingerprint from that preview**:

```bash
npm run db:prepare -- --apply \
  --confirm-db giftdb \
  --confirm-environment development \
  --confirm-target '<full fingerprint from preview>'
```

The tool rechecks the live target and accounts before creating:

- A binary/simple-collation unique `users.email` index. The application stores this field trimmed and lowercased, and login uses the same binary comparison.
- A TTL index on `sessions.expiresAt`; expiration is also enforced on every authenticated request.

Equivalent existing indexes, including ones with different names, are retained. Repeated initialization is safe. Incompatible names, keys, uniqueness, sparse/partial/collation settings, or TTL values block preparation; the command never drops indexes or changes them with `collMod`. It never normalizes, deletes, merges, or claims accounts. Resolve email/index conflicts through a separately reviewed migration with backups and authorized access; the report intentionally does not identify private accounts. A missing/blank/non-string email is an invalid-email conflict. Other existing email syntax is not automatically revalidated or repaired.

Pause application writers during preparation. Preflight cannot prevent concurrent account/index changes, and multiple index creations are not a transaction. If a later creation fails, an earlier one may exist: inspect and preview again, without dropping anything automatically. Creating the TTL index enables MongoDB's background removal of already expired **sessions**; account records are preserved. Email inspection scans all accounts and keeps normalized comparison values in memory, so schedule and size the operator process appropriately for a large database.

Normal server startup only **checks** these indexes; it never creates them, imports demo data, or migrates accounts. Startup fails closed if required indexes are missing. Prepare a new database before starting the backend; it will still have no gifts until a separate, permitted seed/import operation.

### Remote MongoDB and deployment preparation

Use [giftlink-backend/.env.remote.sample](giftlink-backend/.env.remote.sample) as a template, without replacing a working `.env`. Supply `MONGO_URL` through an ignored local environment file or secret manager and set an explicit `MONGO_DB_NAME`. Standard `mongodb://` multi-host/replica-set URIs and `mongodb+srv://` URIs are supported; the URI database path does **not** select the application database. URI-encode reserved characters in credentials. Do not put real connection strings in commands, screenshots, logs, or commits.

Set `DB_ENVIRONMENT` to the actual `development`, `staging`, or `production` tier. This is an operator assertion, not an inference from database names or `NODE_ENV`; verify it against the provider project/cluster. System databases `admin`, `config`, and `local` are refused. Choose the provider, cluster, network access rules, TLS trust, database, and operator permissions separately. Use read/list-index permissions for preview and narrowly scoped create-index privileges only for approved execution.

Remote inspection requires an explicit flag, even for dry-run:

```bash
npm run db:prepare -- --dry-run --allow-remote
```

After independently verifying the project/cluster, review the report and execute only with authorization for that environment/database:

```bash
npm run db:prepare -- --allow-remote --apply \
  --confirm-db '<approved database>' \
  --confirm-environment staging \
  --confirm-target '<full fingerprint from preview>'
```

Replace the database/fingerprint placeholders. For production, configure `DB_ENVIRONMENT=production` and explicitly use `--confirm-environment production`; staging confirmation cannot approve production. `--allow-remote` alone never authorizes writes. The fingerprint binds endpoints, database, environment, and observed topology; changed targets or standalone server restarts require a fresh preview. It is a confirmation aid, not a credential or proof of ownership. It does not replace provider-side verification or change approval.

Remote preparation requires verified TLS (`mongodb+srv` enables it by default; standard remote URIs need `tls=true`). Proxy options, Unix sockets, and disabled certificate/hostname verification are refused. A single verified loopback endpoint is forced to a direct connection; discovery-enabled/multiple-host targets require remote authorization and TLS. A loopback address cannot prove that a tunnel/container actually belongs to development: verify it yourself. Demo seeding retains its separate local-only restrictions and cannot seed remote databases.

Database TLS and application HTTPS are separate requirements. In staging/production set `NODE_ENV=production`, an exact HTTPS `APP_ORIGIN`, and arrange same-origin frontend and `/api` routing with TLS termination. Secure HttpOnly `__Host-` cookies require browser HTTPS regardless of where MongoDB runs. Remote MongoDB configuration does not select a web host, configure TLS termination, or relax CSRF/cookie rules. No real remote database is initialized by this change or its tests.

### Start the application

In separate terminals:

```bash
cd giftlink-backend
npm start
# npm run dev uses the same server.js bootstrap via nodemon
```

```bash
cd giftlink-frontend
npm start
```

MongoDB and required indexes must be ready before Express listens. The API root returns `Inside the server`. Constructing/importing `app.js` never connects, seeds, or listens. Use `npm start` or `node server.js`, not `node app.js`.

### Environment variables

| Variable | Purpose/default |
| --- | --- |
| `MONGO_URL` | Required server/utility MongoDB URI. |
| `MONGO_DB_NAME` | Application database selection, independent of the URI path. Server defaults to `giftdb`; identity preparation requires an explicit value. |
| `DB_ENVIRONMENT` | Required for identity preparation: exactly `development`, `staging`, or `production`. Independent of runtime `NODE_ENV`; does not itself enable writes. |
| `APP_ORIGIN` | Exact browser application origin, without trailing slash/path. Defaults to `http://localhost:3000` in development; explicitly required as HTTPS in production. Also controls CSRF and credentialed CORS. |
| `SESSION_TTL_SECONDS` | Fixed session lifetime, default 28,800 seconds (8 hours), allowed range 300–604,800. No sliding extension. |
| `PORT` | Backend port, default `3060`. |
| `NODE_ENV` | `production` enables Secure `__Host-` cookies and requires an HTTPS application origin. |
| `REACT_APP_BACKEND_URL` | Development API origin. Leave empty for intended same-origin production `/api` routing. Never put secrets in `REACT_APP_*`. |

`JWT_SECRET` is no longer used. No authentication token or signing key is stored in browser storage or exposed in JSON.

## Authentication design

### Sessions and cookies

Registration/login use bcrypt and issue a cryptographically random opaque session identifier in an HttpOnly, SameSite=Lax, Path=/ cookie. Production uses the Secure, host-only `__Host-giftlink_session` cookie; HTTP development uses `giftlink_session`. Only a SHA-256 digest of the identifier is stored in MongoDB, together with the account ID and expiry. Account and session responses use `Cache-Control: no-store`.

Every protected request loads the unexpired session and current account. TTL cleanup can run late without extending authentication. Login rotates the current browser session. Logout deletes that session and clears its cookie, so a copied cookie is rejected afterward. Other independent browser sessions remain valid. There is no refresh-token or external authentication system.

### CSRF and deployment choice

Cookies suit the intended **same-origin HTTPS deployment**. Every `/api` write, including registration, login, and logout, requires all of:

- An `Origin` exactly matching configured `APP_ORIGIN` (never inferred from request Host/forwarded headers).
- `X-CSRF-Protection: 1`, a non-simple header unavailable to HTML forms.
- `Content-Type: application/json`.

Untrusted browser origins cannot satisfy this combination: preflight/CORS only permits the configured origin, and the server independently checks the write request. Missing/null origins are rejected. SameSite is an additional defense. This header is a CSRF protocol marker, not a secret or authentication token. Non-browser clients must supply the same headers and maintain the cookie jar.

React sends `credentials: include`; local development supports one explicitly configured browser origin on another port. For production, the future host/reverse proxy must serve frontend assets and `/api` under the same origin and terminate TLS. The API does not currently serve the React build itself. Cross-site frontend/API hosting would need a separate cookie/CSRF decision; it is not silently enabled with SameSite=None or wildcard credentialed CORS. No hosting provider or geolocation API is selected here.

### Account endpoints

| Endpoint | Behavior |
| --- | --- |
| `POST /api/auth/register` | First/last name, email, password; `201 { user }` and session cookie. Normalized duplicate email: `409 EMAIL_TAKEN`. |
| `POST /api/auth/login` | Email/password; `200 { user }` and rotated cookie. Unknown account/wrong password share `401 INVALID_CREDENTIALS`. |
| `POST /api/auth/logout` | JSON `{}`; revokes the current session, clears cookie, returns `204`. Idempotent, including expired sessions. |
| `GET /api/me` | Authenticated private account DTO: `{ user: { id, firstName, lastName, email } }`. |
| `PATCH /api/me` | Authenticated name updates only; accepts `firstName` and/or `lastName`. Identity comes from the session, never body/header IDs. |
| `PUT /api/auth/update` | Deprecated URL adapter for `{ name }`, using the same cookie/CSRF checks. A supplied email header must match the authenticated user. Returns `{ user }`, never a bearer token. |

Errors consistently use `{ error: { code, message, fields? } }`. Validation includes bounded string names, scalar email validation, 12-character minimum new passwords and bcrypt's 72-byte UTF-8 maximum. Existing bcrypt hashes remain usable: login accepts bounded legacy passwords up to 1,024 UTF-8 bytes, including bcrypt's historical truncation beyond 72 bytes. New registration rejects overlong passwords. Profile email/password/role/ID changes are not supported. Validation errors do not echo submitted values. Authentication endpoints are throttled to 30 attempts per 15 minutes per IP/process.

Private account serialization is only returned to the authenticated account/newly authenticated registration or login. Public user serialization contains ID and first name only. Logs omit bodies, cookies, authorization, query strings, response headers, and raw database errors. Password hashes, session identifiers, private email/contact fields, and future pickup-location fields are excluded from public gift responses through inclusion projections.

### React migration

AuthContext validates `/api/me` on load and window focus. It represents loading, anonymous, authenticated, and server-error states; protected pages support retry. Successful forms confirm the cookie with `/api/me`. Legacy `sessionStorage` token/name/email values are cleared and never trusted. Server `401` responses invalidate account state and prompt re-login. Background checks preserve unchanged account drafts, and stale responses cannot restore state after logout.

The account page is now registered at `/app/profile`; login preserves an intended account destination. Account updates and logout display failures rather than claiming success. Public browse/search/detail pages do not require authentication. Existing styling is retained. Unused legacy external JavaScript/CSS includes were removed from the React entry HTML.

## Public gift API compatibility

`GET /api/gifts`, `GET /api/gifts/:id`, and `GET /api/search` remain public with the same listing/detail/search behavior and legacy IDs. The original fixture JSON and images are intact. Public responses allowlist existing listing fields; arbitrary private fields are not returned.

`POST /api/gifts` now requires a session and CSRF headers. Its acknowledgment response remains `201 { acknowledged, insertedId }`. It accepts validated existing listing fields and derives `posted_by` from the authenticated user. Caller-supplied owners/private fields are rejected. This is access control on the existing endpoint, not a new item-management feature. Legacy fixture poster IDs are not migrated or assigned to real accounts.

## Explicit demo seeding

Normal startup leaves a new gift collection empty. After verifying the intended local service/database, seed explicitly:

```bash
cd giftlink-backend
npm run seed -- --confirm-db giftdb
```

The command only accepts loopback `mongodb://` targets, refuses production/SRV/proxy/discovery targets, forces a direct connection, and requires a matching database confirmation. URI options are limited to `authSource` and `directConnection`. Upserts insert missing demo IDs without deleting records, overwriting existing gifts, changing users, or creating indexes. Repeated runs preserve existing records. The historical nested importer command remains available using backend dependencies; its old independent package/lockfile is not the application's dependency source.

## Verification and CI

```bash
cd giftlink-backend
npm run lint
npm test
# Public API and identity integration suites only:
npm run test:integration
# Guarded database preparation suite (also included in npm test):
npm run test:preparation
```

Backend suites create fresh Docker MongoDB containers and random databases. Before writes/index creation they verify container label/image/mounts, loopback port, database name, and the actual MongoDB process identity. They ignore application database URLs and credentials, and remove only their own containers/anonymous volumes. Remote-policy tests use placeholder endpoints without contacting them and inject the verified isolated connection for execution tests. Tests cover dry-run, confirmations, conflicts, repeat initialization, preserved accounts, and remote-write prevention. Tests never target development or production data. Docker/download failures fail the suite without falling back to an existing database.

```bash
cd giftlink-frontend
CI=true npm test -- --watchAll=false --runInBand
CI=true REACT_APP_BACKEND_URL= npm run build
```

GitHub Actions runs frozen installs, backend lint and isolated tests, frontend account/session tests, and the strict frontend build on PRs to `main` and pushes to `main`. It uses no application/production credentials and does not deploy.

## Migration and remaining limitations

- Deploy backend and frontend together: old bearer JWTs and `authtoken` response fields are intentionally retired. Everyone signs in again. Browser storage is cleared; existing account password hashes are preserved.
- Review existing email normalization/duplicates and prepare indexes on a confirmed target before starting the new server. No account data has been automatically migrated. Startup is read-only with respect to schema setup.
- The former `db:prepare --confirm-host ...` interface is replaced by preview plus `--apply` and database/environment/fingerprint confirmations. Preparation no longer imports or shares policy with the seed command. Remote execution is available only through the explicit guarded workflow; real provider connectivity, permissions, and topology still require operator verification. No connected remote resources were modified during implementation.
- HTTPS and exact `APP_ORIGIN` are required in production. Review trusted proxy configuration with the chosen host before enabling client-IP forwarding; blindly trusting forwarding headers is unsafe. The current limiter is per process, not distributed.
- Legacy bcrypt hashes consider only the first 72 bytes of overlong passwords. A future reviewed password-reset/rehash strategy can retire this compatibility behavior; existing accounts are not silently rewritten.
- Logout revokes the current session. Password reset, email verification/change, MFA, global session management, and automated account recovery are not implemented. Duplicate-registration feedback can reveal that an email is registered; login errors are generic and rate-limited.
- HttpOnly prevents reading the session token through JavaScript; it does not make XSS harmless. A production CSP and broader content/upload/abuse controls need review before public launch. Account and pickup-location data should never be added to listing DTOs.
- Existing listing search remains a simple unpaginated implementation. Future plan/item/request/conversation authorization must use server-side resource ownership/participant predicates; those features are outside this milestone.
- The optional sentiment example still lacks its logger; its test command and the nested importer test command remain course placeholders. The actual importer is covered by backend seed tests.
- No merge, deployment, production index creation, or production database modification is included.

## License and provenance

Derived from the IBM Developer Skills Network capstone, with the existing [Apache 2.0 license](LICENSE) and attribution retained. Verify individual asset licensing before portfolio redistribution.
