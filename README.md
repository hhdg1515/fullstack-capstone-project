# Move-Out Marketplace — Give Away & Find Free Items

Milestone 6.0 **Engineering Hardening is code-complete**, merged in
[PR #27](https://github.com/hhdg1515/fullstack-capstone-project/pull/27).
Verification used local tests and passing PR/main CI, **not a new live staging E2E run**.
Public launch remains unapproved. Atlas network access, backup/recovery,
production configuration and dependency audit remain deferred launch-readiness items.
See the [closeout evidence and deferred launch blockers](docs/production-readiness.md) and
[deployment, diagnostics, Atlas access, recovery and rollback runbook](docs/operations-runbook.md).
The [Milestone 6.1 UI/UX Refinement plan](docs/milestone-6.1-ui-ux-plan.md)
now has a [design-only audit and local screenshots](docs/milestone-6.1-design-audit.md)
for owner review; UI implementation has not started. This documentation
closeout makes no application, workflow, provider-setting or manual deployment change.

Milestone 6.1 now follows the owner's **Functional Minimalism** direction. Public
discovery/detail and owner inventory reads add `isReserved`, derived from a matching
accepted pickup in the same MongoDB snapshot. It exposes no participant or appointment
details, requires no migration/index setup, and does not change pickup transitions.
Reserved listings remain browsable but show **Pickup arranged**; their request form
is replaced by a check-availability action. Owner inventory calls the stored
`available` publication state **Published**, distinct from reservation and clearance.
Missing reservation metadata is treated as unknown rather than guessed; older API
responses retain a server-checked request path. Deploy the backend before the frontend
when this change is separately approved. Availability can change after a read, so
submission still checks ownership, sessions, CSRF and reservation state on the server.

Move-Out Marketplace remains a React, Express, Node.js, and MongoDB native-driver application. Milestone 5.5 organizes the product around **Give Away** and **Find Free Items**, with one shared account and no fixed account roles. Plans, inventory, anonymous discovery, pickup coordination and handoffs retain their existing APIs and data model. The original GiftLink collection/search and all 16 demo records remain available. Private pickup chat and rescheduling are implemented; notifications, payments, shipping, property integrations, image uploads and external mapping/geocoding APIs remain out of scope.

## Two journeys, one account

The public homepage at `/` presents **Move lighter. Settle smarter.** with two actions:

- **Start Giving** → the existing `/app/plans` dashboard (sign in or register first). Pick a plan to manage items and clearance progress, review Incoming requests across your plans, and complete handoffs. There is no additional giver dashboard or mandatory account-type onboarding.
- **Explore Free Items** → `/app/items`, immediately available to anonymous visitors. Choose a supported state/metro, refine by city/neighborhood and item type, open/share a listing, and sign in only when requesting pickup. **My pickup requests** stays in this journey's navigation.

Primary navigation contains **Find Free Items**, **Give Away**, and **Account**. Journey navigation links existing pages in context; item inventory and progress remain together on each plan's inventory page. The mobile menu has an explicit expanded state, Escape/focus return, and closes on navigation. Active sections, visible keyboard focus, a skip link and main-content focus after page navigation support keyboard/screen-reader use. Query-only discovery changes preserve search focus and the existing URL state. Both homepage actions remain prominent on small screens.

Giver location always comes from that plan. Discovery uses the selected URL state/metro and filters, with an optional browser-local preference containing only region IDs. The same account can browse another area without changing a plan. No account-location schema or fixed user role is added; see the Milestone 6.3 model and index contract below. Existing server-derived giver/receiver authorization remains in effect for each action.

| Route | Journey / compatibility |
| --- | --- |
| `/` | Public two-path homepage; default destination after login/registration without a pending action and after logout |
| `/home.html` | Old static home link redirects to `/`; the client route also renders Home |
| `/app/plans`, `/app/plans/new`, `/app/plans/:id`, `/app/plans/:id/edit` | Give Away: existing protected plan pages |
| `/app/plans/:id/items` | Give Away: existing inventory and clearance progress, including `?edit=` links |
| `/app/pickups/incoming` | Give Away: consolidated incoming requests |
| `/app/items`, `/app/items/:id`, `/app/items/:id/request` | Find Free Items: unchanged discovery/shared detail URLs; request form remains protected |
| `/app/pickups` | Find Free Items: outgoing requests |
| `/app/pickups/:id` | Existing private URL; context comes from the server-reported request role, with incoming/outgoing return links |
| `/app/profile`, `/app/login`, `/app/register` | One account system; no permanent giver/receiver choice |
| `/app`, `/app/search`, `/app/product/:id` | Original demo gift collection, search and details, retained in footer links |

Protected navigation preserves the intended path, query and fragment through login **and registration**, including switching between their forms. Login/register loops and external destinations fall back to `/`. This is a frontend navigation change; session validation, APIs, pickup/inventory services and database preparation remain unchanged. Public listing/filter URLs and browser Back/Forward keep working. No migration or new environment setting is required when upgrading from Milestone 5.

The Create React App deployment contract is unchanged: build `giftlink-frontend` with `npm ci` and `CI=true npm run build`, publish its `build` directory, and configure the existing host's SPA fallback to `index.html` for client routes (preserving actual static files and existing `/api` routing). Keep `REACT_APP_BACKEND_URL` deployment-specific using existing configuration; same-origin production uses an empty value and the established HTTPS/cookie/CSRF requirements. No Vercel project, credentials, environment variables or deployment settings are created/changed by this milestone. An existing Git integration may automatically build PR previews when a branch is pushed; no deployment commands are run. A live Vercel deployment is not validated by local browser checks.

Future UX work includes research on the initial homepage copy, richer inventory summaries, and messaging/rendezvous/notification improvements. No new pickup or inventory business behavior is introduced here.

### Frontend-only previews and connecting a real backend

A Vercel deployment of the CRA frontend does not itself deploy Express or MongoDB. With no API routing, `/api/me` or `/api/gifts` may return the frontend's `index.html` (even HTTP 200). That is a missing/misrouted service, not a JSON API or a signed-out user. The frontend detects HTML, invalid JSON and invalid session payloads and shows a service-unavailable message instead of a JSON exception or `null.user` crash. The homepage/navigation remain available; discovery and legacy gift pages offer retry controls. Account forms explain the outage, and private pages stay protected. No users, sessions or successful registration/login states are simulated in the browser.

When the existing API connection recovers, Retry connection revalidates `/api/me`; registration/login continue using the real Express endpoints, bcrypt-backed accounts and server-confirmed HttpOnly sessions. A successful form response alone does not sign a user in: `/api/me` must confirm the accepted cookie and a valid user response. Legacy gift/search/detail pages use the same response handling and can recover with Retry. An empty real collection is shown as empty rather than a service error.

For a future approved deployment:

1. Deploy the existing Express backend separately with its MongoDB replica set and guarded index preparation. Do not put database URIs/credentials in Vercel frontend variables.
2. Prefer serving/proxying `/api/*` under the frontend's HTTPS origin, **before** the SPA fallback. Forward API paths, request/response headers, Origin/CSRF headers and Set-Cookie correctly; missing API routes must not be replaced with HTML. Leave `REACT_APP_BACKEND_URL` empty for this arrangement.
3. Set the backend's exact HTTPS `APP_ORIGIN` to the approved frontend origin and use `NODE_ENV=production` for Secure HttpOnly cookies. Preserve the existing session/CSRF requirements. Pointing the browser directly at an unrelated backend origin needs a separate same-site/cookie/CORS decision; a URL alone does not make cross-site login reliable.
4. Verify `/api/me` returns JSON `401` before login and JSON `200 { user }` after real registration/login; logout must revoke the session. Check this against the actual approved host. `REACT_APP_BACKEND_URL` is a CRA **build-time** value: changing it requires a new frontend build. With existing same-origin `/api` routing, a recovering backend needs no frontend mode flag or fake-data switch.

Never set a hosted frontend's API origin to `localhost`; that points at each visitor's own computer. This fix changes no hosting settings, backend contracts, database schemas or real remote data. Local browser verification covers both frontend-only HTML fallback and recovery against the real Express API using an isolated test database; it does not verify a live deployment's proxy/cookie configuration.

### Protected staging automation

The approved staging alias is `https://moveout-e2e-clarkswift1-9306s-projects.vercel.app`. Store `VERCEL_AUTOMATION_BYPASS_SECRET` only as an `isolated-e2e` Environment secret. The staging and remote E2E workflows use it for provider automation access; never add it to a frontend/Vercel build variable, `REACT_APP_*`, URL, workflow input or saved browser state. Ordinary visitors retain Deployment Protection, and application sessions/CSRF/ownership checks still apply.

See the [staging automation runbook](docs/hosted-staging-integration.md#approved-protection-bypass-for-automation) for scoped headers, browser cookie bootstrap, credential diagnostics and the post-merge sequence: read-only diagnosis, reviewed deployment/API origin update, HTTPS preview, bounded browser tests and owned-run cleanup. Normal CI uses only synthetic bypass credentials and isolated MongoDB; it does not deploy or use the stored staging secret.

## Requirements

- Node.js 22 and npm.
- Docker for local MongoDB and isolated backend tests.
- MongoDB 8.0 configured as a replica set (including a single-member local set), or a transaction-capable managed/sharded deployment. Transactions keep plan and item changes consistent; a standalone server is refused at startup.
- No IBM Skills Network account, Kubernetes cluster, or original course database is needed.

## Local setup

From the repository root:

```bash
npm --prefix giftlink-backend ci
npm --prefix giftlink-frontend ci
```

For a **new** local development replica set, use a separate container, port, and volume. This leaves the earlier standalone development container/data untouched:

```bash
docker run --detach --name giftlink-mongo-rs \
  --publish 127.0.0.1:27018:27017 \
  --mount source=giftlink-mongo-rs-data,target=/data/db \
  mongo:8.0 --replSet giftlink-dev --bind_ip_all
```

Verify the fresh container's identity, port and mount using `docker inspect giftlink-mongo-rs` before the following **one-time local initialization**:

```bash
docker exec giftlink-mongo-rs mongosh --quiet --eval 'rs.initiate({_id:"giftlink-dev",members:[{_id:0,host:"127.0.0.1:27017"}]})'
docker exec giftlink-mongo-rs mongosh --quiet --eval 'db.hello().isWritablePrimary'
```

Wait for the read-only primary check to return `true` before preparing indexes. On later runs use `docker start giftlink-mongo-rs`; do not reinitialize an existing set. The external client uses port 27018 and `directConnection=true` because the single member advertises its container-local port 27017. Do not replace an unrelated service occupying either port. Tests never use this container or volume.

An existing Milestone 2 standalone database requires an operator-reviewed backup/restore into a replica set, or a reviewed restart/configuration change preserving its data. This repository does not convert, delete, or migrate an existing database automatically. Choosing the new example database starts empty; it does not move earlier accounts/plans for you.

Copy local configuration without replacing existing files:

```bash
cp -n giftlink-backend/.env.sample giftlink-backend/.env
cp -n giftlink-frontend/.env.sample giftlink-frontend/.env.local
```

Backend example:

```dotenv
MONGO_URL=mongodb://127.0.0.1:27018/?directConnection=true
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

### Prepare database indexes explicitly

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
- A non-unique compound `moveOutPlans` index on `{ ownerId: 1, moveOutDeadline: 1, _id: 1 }` for private owner listings in deadline order.
- `plan_metro_discovery` on `{ metroId: 1, status: 1, stateId: 1, _id: 1 }` for regional discovery; `pickup_messages_request_time` on `{ requestId: 1, createdAt: -1, _id: -1 }` for private message history. Both are required by startup; neither is created automatically.
- Non-unique `items` indexes on `{ planId: 1, ownerId: 1, createdAt: 1, _id: 1 }` and `{ status: 1, publishedAt: -1, _id: -1 }` for management and public discovery.
- Non-unique `items_pickup_start` on `{ status: 1, availableFrom: 1, publishedAt: -1, _id: -1 }` for pickup-start filtering during discovery.
- Four `pickupRequests` indexes: `pickup_received` on `{ giverId: 1, _id: -1 }`, `pickup_sent` on `{ receiverId: 1, _id: -1 }`, unique `pickup_one_accepted` on `{ itemId: 1 }` **only where `status: "accepted"`**, and unique `pickup_active_receiver` on `{ itemId: 1, receiverId: 1 }` **only where `active: true`**. Exact partial predicates and binary collation are checked on startup/preparation; a broader/different predicate is incompatible.
- Four `itemImages` indexes listed in the [B2 preparation notes](docs/milestone-6.5b2-photo-metadata.md#configuration-and-guarded-preparation). Explicit preparation includes these regardless of runtime configuration; startup requires them only when metadata is explicitly enabled. Disabled startup still requires every pre-B2 index above and needs no photo schema change.

Equivalent existing indexes, including ones with different names, are retained. Repeated initialization is safe. Incompatible names, keys, uniqueness, sparse/partial/collation settings, or TTL values block preparation; the command never drops indexes or changes them with `collMod`. It never normalizes, deletes, merges, or claims accounts. Resolve email/index conflicts through a separately reviewed migration with backups and authorized access; the report intentionally does not identify private accounts. A missing/blank/non-string email is an invalid-email conflict. Other existing email syntax is not automatically revalidated or repaired.

Pause application writers during preparation. Preflight cannot prevent concurrent account/index changes, and multiple index creations are not a transaction. If a later creation fails, an earlier one may exist: inspect and preview again, without dropping anything automatically. Creating the TTL index enables MongoDB's background removal of already expired **sessions**; account records are preserved. Email inspection scans all accounts and keeps normalized comparison values in memory, so schedule and size the operator process appropriately for a large database.

Normal server startup only **checks** these indexes; it never creates them, imports demo data, or migrates accounts/plans. Startup fails closed if required indexes are missing. Prepare a new database before starting the backend; it will still have no gifts or plan documents until an explicit seed operation or authenticated plan creation.

**Upgrading from Milestone 4:** run the same preview/approval workflow before startup. The preview retains the six compatible existing indexes and reports four pickup indexes. It reports duplicate accepted/active-receiver request groups using counts only and blocks conflicting data/indexes; it never repairs, merges or cancels requests as an administration side effect. Initialization preserves accounts, sessions, plans, items, requests and gifts; no label normalization or document migration is performed. Existing plans have no pickup timezone: their listings stay browsable, and the giver must explicitly set a timezone in Edit plan before receiving requests. The transaction-capable target requirement, `db:prepare` interface and remote safeguards are unchanged. Replica-set initialization remains separate administration and is never performed by startup or `db:prepare`.

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

MongoDB, required indexes, and a replica-set/sharded topology must be ready before Express listens. Startup only reads topology/index metadata. The API root returns `Inside the server`. Constructing/importing `app.js` never connects, seeds, or listens. Use `npm start` or `node server.js`, not `node app.js`.

### Environment variables

| Variable | Purpose/default |
| --- | --- |
| `MONGO_URL` | Required server/utility MongoDB URI. |
| `MONGO_DB_NAME` | Application database selection, independent of the URI path. Server defaults to `giftdb`; database preparation requires an explicit value. |
| `DB_ENVIRONMENT` | Required for database preparation: exactly `development`, `staging`, or `production`. Independent of runtime `NODE_ENV`; does not itself enable writes. |
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

## Move-out Plans

Select **Give Away** in primary navigation and sign in. `/app/plans` lists your plans in deadline order; create directly at `/app/plans/new`. Each plan links to a detail view and an edit form. Creation needs only a deadline, city, and neighborhood; the title is optional. You may create multiple plans. There is no address, tenancy, HOA, item, or mapping requirement, and no multi-step onboarding.

All plans are private to their owner. The interface supports session checks, loading, an empty dashboard, field validation, retries, save progress, and expired-session login prompts. Unsaved edits survive background validation of the same account. Private fetched data is discarded when switching accounts/routes, and stale requests cannot replace the current account's data.

### Model and date policy

`moveOutPlans` stores:

| Field | Meaning |
| --- | --- |
| `_id` | MongoDB ObjectId, returned as string `id`. |
| `ownerId` | Account ObjectId derived from the authenticated session. Never accepted from the caller or included in plan responses. |
| `title` | Optional trimmed single-line text, at most 120 characters; omitted/cleared titles are stored as `""`. |
| `moveOutDeadline` | Required real calendar date, exactly `YYYY-MM-DD`, stored as a string. |
| `city`, `neighborhood` | Required trimmed single-line labels, 1–100 characters each. Free text retained independently of the curated region IDs; no geocoding or residence verification. |
| `stateId`, `metroId` | Optional validated Census/state FIPS and CBSA IDs. Items inherit the region through their plan. Legacy plans remain unassigned until an explicit owner edit. |
| `status` | Created as `active`; owners may edit to `active`, `completed`, or `cancelled`. |
| `createdAt`, `updatedAt` | Server-generated BSON dates, serialized as UTC ISO timestamps. Creation time is immutable. |

Deadlines represent calendar dates, without a pickup time or timezone conversion. New plans and changed deadlines must be today or later using the current **UTC date** on the backend; the form explains and follows that boundary. Impossible dates, timestamps, offsets, scalar-type mismatches, and unsupported fields are rejected. Date display explicitly preserves the calendar day across browser timezones.

Passing the deadline does not automatically change status, hide, or delete a plan. Owners may still edit its other details, keep its unchanged past deadline, or select a new current/future deadline. Status changes are manual and reversible; there is no speculative workflow or automatic item lifecycle. A later product decision may adopt a neighborhood timezone or a precise deadline time, which would require an explicit model/validation change.

### Private plan API

All endpoints require the existing valid session cookie; writes also require the existing Origin/CSRF/JSON protocol. Responses use `Cache-Control: no-store`.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/move-out-plans` | `{ moveOutDeadline, city, neighborhood, title?, pickupTimeZone?, stateId?, metroId? }` → `201 { plan }` plus a Location header. Ownership, status, and timestamps are server-derived. |
| `GET /api/move-out-plans` | `200 { plans: [...] }` for the current owner only, sorted by deadline then ID. Query parameters cannot select another owner. |
| `GET /api/move-out-plans/:id` | `200 { plan }` for an owned plan. |
| `PATCH /api/move-out-plans/:id` | Nonempty partial update of title/deadline/city/neighborhood/stateId/metroId/status/pickupTimeZone, optional `confirmCancelRequests` → `200 { plan }`. |

A plan DTO contains only `id`, `title`, `moveOutDeadline`, `city`, `neighborhood`, `pickupTimeZone` (null when unset), `status`, `createdAt`, and `updatedAt`, plus nullable `stateId`, `metroId`, `stateLabel` and `metroLabel`. Private contact, address, password, and session fields are excluded by database inclusion projections and response serialization. Read and update queries include both the plan ID and the authenticated owner ID; updates never trust a supplied owner. Missing, malformed, and other users' plan IDs share `404 PLAN_NOT_FOUND`. Validation uses `400 VALIDATION_FAILED` with field messages without submitted values. Missing/expired sessions use `401`; invalid write origins use `403`.

Each plan can now have any number of incremental items, including zero. Plan editing never copies location/deadline into item documents. A shorter deadline that conflicts with item overrides returns `409 ITEM_DATE_CONFLICT` with the affected owned item IDs/names/dates. The edit form leaves the proposed plan unchanged, links to those item editors in new tabs, and keeps its draft. Explicitly edit/clear the overrides or choose another deadline, then retry. There is no silent date truncation or bulk account/data repair.

## Inventory workflow and item API

From plan detail choose **Manage items** (`/app/plans/:id/items`). **Save Draft** needs only an item name. **Publish** requires a name, canonical category, matching item type and nonblank description (at most 2,000 characters), enforced on the server. Condition is optional. Names allow 1–160 characters and may describe a group. New items inherit the plan deadline; Available from remains optional. Existing item end overrides are preserved and editable under **Pickup end override**; there is no creation-time end field or reset button. After creation the blank form stays ready for another item and refocuses its name. Existing items remain above it.

Cards use Draft, Posted, Reserved, Hidden, Expired and Cleared. **Picked Up** requires a verified completed handoff for this clearance; accepted appointments and manual clearance cannot claim collection. Old ambiguous clearance remains Cleared. These presentation labels do not change stored states. Incomplete drafts offer **Complete listing**; edits can publish atomically. **Hide listing** withdraws without clearance progress. Manual **Mark as cleared** and **Reopen as draft** are under labeled More actions, with confirmations; no records are deleted. Clearance progress still counts item records/groups, including verified completed pickups, rather than objects inside a group.

Failed saves preserve drafts; stale versions require review/reload. Existing unsaved-draft protection, competing-write prevention and reservation-cancellation confirmations remain. Configured pickup timezone is shown once at plan level, with an accessible correction disclosure in Edit Plan. No per-item timezone is entered.

| Item field | Meaning |
| --- | --- |
| `_id`, `planId`, `ownerId` | ObjectIds; server derives the owner and verifies the owned parent for every management operation. Items cannot be moved between plans through the API. |
| `categoryId`, `itemTypeId`, `condition` | Category and matching type are required to publish; condition stays optional. Drafts/legacy edits may remain unclassified. Original category text is preserved; partial edits validate the resulting tuple. |
| `name`, `description`, `category` | Name required; description required for new publication; legacy category text preserved. Unknown fields, markup, control characters and ownership/location/price spoofing are rejected. |
| `availableFrom`, `availableUntil` | Optional `YYYY-MM-DD` strings or `null`. Empty fields become `null`; shared location/deadline are never duplicated. |
| `status` | Stored lifecycle state; the API additionally derives expiry from the effective latest pickup date on every read. |
| `createdAt`, `updatedAt`, `publishedAt` | Server timestamps. `publishedAt` starts as `null` and records the first explicit publication; relisting retains it. It is separate from pickup dates. |
| `version` | Owner-facing optimistic concurrency version, required for edits/actions. Not exposed in public DTOs. |
| `publicationRequirementsVersion` | Server-only version set on successful publication; private responses expose only `requiresPublicationDetails`. Existing unmarked posts remain ordinarily editable; explicit republication adopts current requirements. |
| `clearedByPickupRequestId` | Server-only provenance set by new existing handoff completions and removed on reopen/manual clearance. Private inventory returns only verified `isPickedUp`; no request/participant references enter public APIs. |

Effective earliest pickup is the explicit `availableFrom`, or **immediately** when omitted. Effective latest pickup is `availableUntil`, or the current plan deadline when omitted. Validate an explicit start against the effective end, and require `end <= plan deadline`. Publishing/reopening additionally requires `end >= today (UTC)`. The end date is inclusive. Historical drafts, withdrawn items and cleared items can retain past dates for recordkeeping. All date inputs remain calendar strings and use the existing UTC comparison policy. New start selections cannot be past dates; unchanged historical starts remain editable/publishable while the effective end remains valid. Today is allowed even after midnight; an omitted start means immediately. These dates are not pickup instants.

Future pickup starts do not delay publication: a published listing is offered now, with its future pickup window clearly displayed. `publishedAt` means first public visibility, not a pickup appointment. Date-only discovery retains UTC comparisons; explicit appointment timezones are described below.

| State/action | Behavior |
| --- | --- |
| Create draft | Private; defaults to `draft`. Can be edited or cleared. |
| Publish/relist | Draft, unlisted, or expired → `available`, after required-detail/date/policy checks and verification that the plan is active. |
| Unlist | Available/expired → `unlisted` immediately; no reason required, no progress increment. |
| Mark cleared | Any non-cleared state → `cleared`; public visibility ends and clearance progress increases. Any external clearance channel is allowed. |
| Reopen as draft | Cleared → private `draft`, after valid-current-date checks. Progress decreases; publish separately when ready. |
| Expiry | Available items whose effective end is before today are returned as `expired` and excluded from public reads without a scheduler. |

Editing an expired item's dates keeps it expired until explicit publication. A plan edit persists already-expired available items as `expired` before extending its deadline, so extending a plan cannot silently republish them. First publication time is preserved. Deactivating a plan hides its available items; explicitly reactivating the plan restores still-valid available items. Unlisted/cleared/draft/expired items remain private.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/move-out-plans/:planId/items` | Private plan context, items and `{ total, cleared }` progress. |
| `POST /api/move-out-plans/:planId/items` | `{ name, description?, category?, categoryId?, itemTypeId?, condition?, availableFrom?, availableUntil?, publish? }` → `201 { item }`. `publish` is an explicit boolean intent; default false. |
| `PATCH /api/move-out-plans/:planId/items/:id` | Partial item details plus numeric `version` and optional boolean `publish` → `{ item }`. `publish:true` completes details and publishes an eligible draft/hidden/expired item atomically. No ownership, arbitrary status, price or shared-location changes. |
| `POST /api/move-out-plans/:planId/items/:id/actions` | `{ action: "publish" | "unlist" | "clear" | "reopen", version }` → `{ item }`. |
| `GET /api/items` | Anonymous filtered, sorted and cursor-paginated discovery; see below. |
| `GET /api/items/locations` | Public city/neighborhood options, derived exclusively from visible listings. |
| `GET /api/items/:id` | Anonymous detail only while currently publicly offered; unavailable/nonexistent/malformed IDs all return 404. |

Both item ownership and parent-plan ownership are required; mismatched/orphaned records cannot leak through management or public joins. All writes reuse sessions, Origin/CSRF/JSON requirements, bounded validation and safe error handling. `409 ITEM_CHANGED` rejects stale versions. Multi-document transactions touch the parent on **every** plan/item mutation, preventing concurrent deadline edits and item writes from committing incompatible data. Driver retries revalidate against a fresh snapshot. Public reads use snapshot aggregation joining the current plan and check matching ownership, active plan, publication, available state and effective end/range. The collection has no TTL index or automatic record deletion.

**Find Free Items** (`/app/items`) provides public search/detail separately from the demo gift collection. Public DTOs allowlist name, description, category, safe general location, pickup dates, deadline, state and first publication timestamp. Owner IDs, parent IDs, versions, email, contact/address fields, hashes and tokens are excluded. Responses and fetches use no-store; public pages refresh on focus or explicit refresh. Previously downloaded public text cannot be revoked, and an already-open page needs a refresh to reflect withdrawal.

Publication blocks obvious restricted-goods keywords and email patterns, and the form requires safe, lawful household goods with no contact/address details in public text. This narrow, conservative filter is **not complete content moderation**: it can miss obfuscated or other prohibited goods and private details, and can reject harmless matching text. There is no automated safety guarantee, reporting/review system or external moderation service yet. Those controls and marketplace abuse handling need design before public launch; there is no claim that plain-text validation makes listings safe.

## Anonymous neighborhood discovery

Open **Find Free Items** (`/app/items`) without registering or signing in. Choose **State → Metro area** before any listings are requested. Then search titles/descriptions/types, refine by category/type/condition and city/neighborhood, filter pickup availability, and sort by newest publication or earliest effective pickup deadline. Location labels are approximate public text; they do not restrict who may browse or eventually receive an item. There is no location tracking, GPS permission, map, geocoder or external search provider.

Within the selected metro, city/neighborhood selectors are populated from currently eligible listings and deduplicated after whitespace normalization and case-insensitive comparison, including common Unicode whitespace/case variants. Choosing a city narrows neighborhood suggestions and clears a previous neighborhood selection. With All cities, a neighborhood label searches across cities within the metro. A city can be selected without a neighborhood. Raw stored plan labels are preserved; comparison/display normalization happens at read time.

Filters and sort order are stored in URL query parameters, so filtered pages can be shared and browser Back works normally. Changing filters restarts pagination, and late responses from an earlier query cannot replace new results. **Load more** appends the next server page and deduplicates IDs. Loading, empty, retry and expired-cursor states have explicit controls. Location-option failures have an independent retry and do not block general browsing. Focus/Refresh rechecks current publication visibility and restarts the first page while retaining filters.

Cards show name, type/category (or legacy fallback), optional condition, general location, **Available Now** or **Available Later**, earliest pickup when specified, and effective latest pickup. Details include the full description, first publication date, and a read-only direct URL with Copy link/manual-copy fallback. Links work anonymously. Cards use text; no photos are fabricated and no fake reservation/pickup control is provided.

### Query and availability contract

`GET /api/items` accepts only these single-valued parameters:

| Parameter | Meaning/default |
| --- | --- |
| `stateId`, `metroId` | Required supported state/metro pair. Example: `stateId=06&metroId=41860`. Cross-state metros cover all their member states, not only the entry state. |
| `categoryId`, `itemTypeId`, `condition` | Optional catalog IDs. A type must belong to the selected category. |
| `q` | Optional literal phrase across name, description, legacy category or standardized type, with a small explicit synonym mapping. Case-insensitive; whitespace collapses. Maximum 100 input characters; regex operators are escaped. |
| `city`, `neighborhood` | Optional exact labels after whitespace/case normalization. Each at most 100 input characters. Neither is required. |
| `availability` | `all` (default), `now`, `later`, or `date`. |
| `date` | Required only with `availability=date`: valid `YYYY-MM-DD`, today or later in UTC. Other combinations are rejected. |
| `sort` | `newest` (default) or `deadline`. |
| `limit` | Canonical integer 1–50; default 12. This is a per-page bound, replacing the old total 50-result cap. |
| `cursor` | Opaque continuation from the previous page; retain the same filters, sort and page size. At most 1,024 characters. |

Unknown parameters, repeated/array/object values, oversized text, invalid dates, excessive page sizes and unsupported sort/filter modes return `400 INVALID_DISCOVERY_QUERY`. Text errors never echo submitted values. `GET /api/items/locations` accepts the state/metro pair for scoped options; the old bounded label-only metadata response remains available without it. Unscoped **listing** queries return `400 REGION_REQUIRED`; invalid IDs/pairs return 400 without guessing a location.

Each feed response is `{ items, total, today, page: { limit, hasMore, nextCursor } }`. `total` counts the same filtered eligible set before the cursor boundary, not just this page. Accepted reservations, hidden/cleared/expired items, unassigned regions and missing timezone setup do not inflate the count. Count and page share one snapshot query; changes between HTTP pages still require refresh. `today` is the server's UTC calendar date. `nextCursor` is `null` at the end. Item/detail DTOs retain the Milestone 3 public fields and add `availability: "now" | "later"` and `pickupTimeZone` (IANA string or null), classification labels, region ID/label pairs and a server-validated `isOwner` boolean; detail also returns `today`. Owners see Your listing instead of request controls, and the backend independently rejects self-requests with `409 OWN_ITEM`. Owner IDs, plan IDs, versions, credentials and private fields remain excluded.

**Now** means the explicit start is today/past or omitted; **Later** means an explicit start is after today. General browsing includes both. For a selected date, an item matches only if its start is omitted or on/before the date, and its effective end (`availableUntil ?? plan.moveOutDeadline`) is on/after the date. Boundaries are inclusive. Expired items are excluded even if a caller requests another date. Publication time is never substituted for a pickup start. React displays the API's availability classification and uses UTC-preserving calendar formatting. Changing this existing discovery-date convention to neighborhood-specific dates remains deferred.

## Pickup coordination and handoff

1. The giver explicitly selects **Pickup timezone** in Create/Edit plan, using an IANA identifier such as `America/Los_Angeles`, `Asia/Kolkata`, or `UTC`. No browser, city lookup, environment variable, offset or geocoder supplies a hidden default. Setup is optional for legacy browsing and required to receive pickup requests.
2. A receiver follows **Request pickup** on a public detail link, signs in if necessary, selects a local date/time in the displayed giver timezone, and optionally leaves a private note (500 plain-text characters). Each listing, including a box/group, is one indivisible pickup unit. No residential address is requested. Suggest general public rendezvous instructions rather than personal contact/address details.
3. **Incoming requests** consolidates the giver's requests across all plans; **My requests** shows the receiver's proposals. Filter by status to review accepted appointments. Lists use 25-record pages with Next/First controls. A private detail retains the item's full description after withdrawal/clearance, shows the other party's first name only, appointment timezone, note, status and action history. A receiver never receives private plan title/ID; the giver sees a management link to their own plan.
4. The giver accepts/declines. A pending request never reserves an item. An accepted appointment reserves that entire listing until cancellation, no-show or completion; it is not a recorded handoff. Other pending proposals remain pending. New submissions are blocked while reserved, although public discovery remains available. Use the request conversation to coordinate. Future accepted appointments can change only through the formal proposal/acceptance workflow described below; chat never changes the appointment.
5. Either party can cancel; the giver records the actual handoff or a no-show after the scheduled time. Completion clears the item and cancels competing requests atomically. No-show releases the reservation without clearing the item or selecting another receiver. All actions require confirmation and a fresh request version.

### Time semantics

The API accepts a minute-precision local `YYYY-MM-DDTHH:mm` and the plan's explicit `timeZone`. The server uses pinned `@js-temporal/polyfill` with the Node/ICU IANA timezone database, converts with `disambiguation: "reject"`, and stores `proposedAt` as a BSON UTC instant plus `localDateTime` and `timeZone`. Invalid dates, past instants, nonexistent spring-forward times and repeated fall-back times are rejected. Choose a different unambiguous time; callers cannot override ambiguity with a supplied offset. React formats the stored instant in the recorded timezone, even when the viewer's browser uses another zone.

Availability **labels** retain their existing YYYY-MM-DD values. For appointments, the proposed instant's date **in the giver-selected timezone** must fall between explicit `availableFrom` (or immediate) and `availableUntil ?? moveOutDeadline`, inclusive. The instant must also be before **00:00 UTC on the following end date**, preserving the existing global listing expiration. For example, a Los Angeles listing ending July 3 cannot book 11pm local July 3, because it has already expired in UTC; choose an earlier time or extend its dates. This deliberate extra cutoff prevents a future accepted appointment from outliving listing availability. Discovery's Now/Later badges still use the existing UTC date convention, so they describe calendar eligibility rather than a neighborhood's exact current clock time.

Expired listings reject new requests and acceptances. Pending proposals whose time has passed cannot be accepted; either party can cancel or the giver can decline them. Accepted appointments whose time has passed remain available for truthful handoff/no-show reporting, including after date expiry; expiry alone does not falsely record a missed or successful pickup. No background job changes their outcome. Completion/no-show before the scheduled instant is refused. Giver-declared zones can be wrong, and future timezone legislation/ICU updates can change wall-clock rendering: the stored UTC appointment remains authoritative. Location verification, grace periods and a neighborhood-aware expiry migration need later product decisions. Future accepted appointments support the formal rescheduling workflow below.

### State machine, authorization and concurrency

| From | Action | Authorized party | To / effect |
| --- | --- | --- | --- |
| New | Submit | Signed-in receiver other than owner | `pending`; no reservation |
| `pending` | Accept | Giver | `accepted`; one reservation |
| `pending` | Decline | Giver | `declined` |
| `pending`, `accepted` | Cancel | Either party | `cancelled`; release reservation |
| `accepted` | Confirm handoff | Giver, at/after appointment | `completed`; clear item and cancel competitors |
| `accepted` | Record no-show | Giver, after appointment | `no_show`; release without clearing |

Terminal requests cannot reopen. A new proposal is a new request. Documents store server-derived giver/receiver/item/plan IDs, appointment, status, `active` (pending/accepted), timestamps, decision/completion timestamps, monotonically increasing version, and actor/time history. Participant DTOs expose actor roles and timestamps, never actor IDs or account secrets. IDs from the browser never establish ownership. Nonparticipants receive 404. Writes reuse session, Origin, CSRF header, JSON, bounded validation and safe logging conventions. Notes never enter public discovery or application logs. Pickup endpoints have an in-process 120 requests/minute/IP limit; deployment proxy/distributed-limit decisions remain as documented for discovery.

All request creation/decisions and inventory/plan writes touch the same parent plan inside a snapshot/majority transaction. MongoDB write conflicts retry against fresh data. Acceptance rechecks listing ownership/state, plan status, appointment/window and existing reservation; unique partial indexes independently enforce one accepted request per item and one active proposal per receiver/item. Stale request versions return `409 PICKUP_CHANGED`. Concurrent submissions, competing accepts, completion/no-show races and withdrawal races are tested. Completion updates the request, clears/version-increments the item, and cancels competing proposals in one transaction. Locks are plan-scoped rather than held while a user reviews a dialog; very large/busy plans may need a narrower measured coordination strategy later.

### Inventory conflicts

| Inventory change | Outstanding-request behavior |
| --- | --- |
| Unlist / external clearance | Cancel all pending/accepted requests; retain unlisted versus cleared distinction |
| Complete/cancel plan | Cancel all outstanding requests; hide its listings |
| Change plan timezone or city/neighborhood | Cancel all outstanding requests so an acceptance never silently changes place/time interpretation |
| Change item dates or plan deadline | Keep requests still inside the new window; cancel incompatible ones |
| Edit description/name or compatible dates | Preserve requests and reservations |
| Successful pickup | Complete selected request, clear item, cancel all competing pending proposals |
| Cancellation/no-show | Release only that reservation; other requests stay pending; never auto-transfer |

Consequential edits first return `409 PICKUP_CONFIRMATION_REQUIRED` with a count and no mutation. React asks explicitly whether to cancel affected requests, then retries with boolean `confirmCancelRequests: true`. Backend rechecks the current state and cancels affected requests with reason, giver actor, time and version increment **in the same transaction** as the edit. A denied confirmation leaves both unchanged. Existing `ITEM_DATE_CONFLICT` checks still require invalid item date overrides to be resolved before shortening a plan; confirmation does not bypass date validation. Reopening a cleared item never restores old requests.

### Authenticated pickup API

| Endpoint | Contract |
| --- | --- |
| `POST /api/pickup-requests` | `{ itemId, localDateTime, timeZone, note? }` → `201 { request }` |
| `GET /api/pickup-requests/sent` | Current receiver's requests, newest ID first |
| `GET /api/pickup-requests/received` | Current giver's requests, newest ID first |
| `GET /api/pickup-requests/:id` | Participant-only `{ request }`, including private item details |
| `POST /api/pickup-requests/:id/actions` | `{ action: "accept" | "decline" | "cancel" | "complete" | "no_show", version }` → `{ request }` |

Lists accept optional `status` (one of the six states) and `cursor` (the previous page's `nextCursor`); return `{ requests, nextCursor }`, with at most 25 rows. Every page is scoped to the session/role. Unknown, structured, repeated or malformed parameters fail validation. Creation returns a clear 409 if a listing changed, timezone setup is missing/changed, the receiver already has an active proposal, or another pickup is accepted. Protected request routes are `/app/items/:id/request`, `/app/pickups`, `/app/pickups/incoming`, and `/app/pickups/:id`.

Remaining launch decisions include contact/rendezvous policies, notifications, moderation/reporting, retention, no-show grace/dispute handling, timezone verification and production abuse controls. Private chat and formal future-time rescheduling use the existing pickup request. No residential address is disclosed automatically; notifications, ratings, payments, shipping and external location services remain outside this flow.

### MongoDB pagination, safety and limits

Search, location/date filtering, visibility and sorting run in MongoDB before page limiting. Public aggregation joins the current plan under snapshot read concern and always checks exact available/publication state, matching item/plan ownership, active plan and valid unexpired dates. Location metadata uses the same gate, so private/empty/inactive plans cannot leak location options. Details apply the gate again; draft, unlisted, cleared, expired, unpublished, orphaned or inactive-parent IDs return `404 ITEM_NOT_FOUND`. Direct URLs are not an authorization bypass.

Newest ordering is `(publishedAt DESC, _id DESC)`; deadline ordering is `(effectiveAvailableUntil ASC, _id ASC)`. Keyset comparisons use the last displayed pair, with one extra record to determine `hasMore`; no offset/skip pagination is used for item pages. A continuation binds the normalized query, sort, page size and initial publication cutoff. Publications newer than the first request wait for a refresh. Cursors expire after 15 minutes or at the next UTC date boundary. Changed filters/page size/sort or malformed cursors return `400 INVALID_CURSOR`; expired/day-boundary cursors return `409 STALE_CURSOR`. The UI offers Start again. A withdrawn anchor need not remain public; its key is only a position, and every next-page record passes current visibility checks.

Cursors are versioned base64url JSON containing public ordering keys and a query fingerprint. They are opaque client state, not encrypted secrets, signed capabilities or authentication. A forged position cannot override filters or reveal private records. Pagination is live, not a long-lived historical snapshot: item/plan edits can move records between pages or filters. The client deduplicates IDs; refresh to obtain a complete current ordering after changes. Already downloaded public text cannot be revoked.

The region index narrows plans before item joins; existing plan/owner, publication and pickup-start indexes remain available for their lookup and compatibility paths. Effective deadlines and normalized locations depend on joined plan data and are not duplicated/backfilled into items. Substring/phrase regex search, cross-collection filters and deadline sorts can scan many candidates and do not offer external-search relevance, stemming, accent-insensitive matching or a complete city/neighborhood taxonomy. Aggregations have a 5-second execution cap and disallow disk spilling; time/memory limits return `503 DISCOVERY_BUSY`, asking the caller to narrow filters/retry. Public discovery/detail/options share a per-process limit of 120 requests/minute/IP and return `429 DISCOVERY_RATE_LIMIT` with retry guidance. Review proxy/IP configuration and distributed limiting with the chosen host.

Location suggestions are capped at 500 distinct public city/neighborhood pairs with a `truncated` flag. Existing shared/API filters still work outside the suggestion list. There is no global geographic registry or guarantee that free-text labels represent official boundaries. Advanced search/index optimization and larger metadata catalogs are future scale decisions.

## Public gift API compatibility

`GET /api/gifts`, `GET /api/gifts/:id`, and `GET /api/search` remain public with the same listing/detail/search behavior and legacy IDs. The original fixture JSON and images are intact. Public responses allowlist existing listing fields; arbitrary private fields are not returned.

Legacy search accepts single string `name`, `category`, `condition`, `age_years`
fields (up to 200 characters; age is a nonnegative whole number of up to three
digits). Regex syntax is treated literally. Unknown/structured/repeated or
malformed filters return `400 INVALID_SEARCH_QUERY`; a five-second query deadline
returns `503 SEARCH_BUSY`. Normal searches and the 16 demo records are unchanged.

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
# Public API, identity, plans, inventory and discovery integration suites:
npm run test:integration
# Guarded database preparation suite (also included in npm test):
npm run test:preparation
```

Backend suites create fresh Docker MongoDB containers and random databases. Before writes/index creation they verify container label/image/mounts, loopback port, database name, and the actual MongoDB process identity. Only then do they initialize their disposable replica set and run real transactions. They ignore application database URLs and credentials, and remove only their own containers/anonymous volumes. Remote-policy tests use placeholder endpoints without contacting them and inject the verified isolated connection for execution tests. Tests cover dry-run, confirmations, conflicts, repeat initialization, preserved records, real concurrent inventory/deadline writes, public visibility and remote-write prevention. Tests never target development or production data. Docker/download failures fail without falling back to an existing database.

```bash
cd giftlink-frontend
CI=true TZ=America/Los_Angeles npm test -- --watchAll=false --runInBand
CI=true REACT_APP_BACKEND_URL= npm run build
```

GitHub Actions runs frozen installs, backend lint and isolated API/identity/plan/inventory/discovery/pickup/preparation tests, frontend journey/navigation/account/session/plan/inventory/discovery/pickup tests in a non-UTC timezone, and the strict build on PRs to `main` and pushes to `main`. It uses no application/production credentials and does not deploy.

## Migration and remaining limitations

- Deploy backend and frontend together: old bearer JWTs and `authtoken` response fields are intentionally retired. Everyone signs in again. Browser storage is cleared; existing account password hashes are preserved.
- Review existing email normalization/duplicates and prepare indexes on a confirmed target before starting the new server. No account data has been automatically migrated. Startup is read-only with respect to schema setup.
- The former `db:prepare --confirm-host ...` interface is replaced by preview plus `--apply` and database/environment/fingerprint confirmations. Preparation no longer imports or shares policy with the seed command. Remote execution is available only through the explicit guarded workflow; real provider connectivity, permissions, and topology still require operator verification. No connected remote resources were modified during implementation.
- HTTPS and exact `APP_ORIGIN` are required in production. Review trusted proxy configuration with the chosen host before enabling client-IP forwarding; blindly trusting forwarding headers is unsafe. The current limiter is per process, not distributed.
- Legacy bcrypt hashes consider only the first 72 bytes of overlong passwords. A future reviewed password-reset/rehash strategy can retire this compatibility behavior; existing accounts are not silently rewritten.
- Logout revokes the current session. Password reset, email verification/change, MFA, global session management, and automated account recovery are not implemented. Duplicate-registration feedback can reveal that an email is registered; login errors are generic and rate-limited.
- HttpOnly prevents reading the session token through JavaScript; it does not make XSS harmless. A production CSP and broader content/upload/abuse controls need review before public launch. Account and pickup-location data should never be added to listing DTOs.
- Legacy demo search and the private plan list remain unpaginated. Native discovery, pickup requests and message history use bounded pages. Private item/request/conversation access uses existing backend ownership/participant checks; frontend labels never grant authorization.
- The optional sentiment example still lacks its logger; its test command and the nested importer test command remain course placeholders. The actual importer is covered by backend seed tests.
- No merge, deployment, production index creation, or production database modification is included.

## License and provenance

Derived from the IBM Developer Skills Network capstone, with the existing [Apache 2.0 license](LICENSE) and attribution retained. Verify individual asset licensing before portfolio redistribution.

## Milestone 5.6 deployment preparation and automated E2E

See [the deployment audit, setup/approval checklist, safe remote test workflow and rollback plan](docs/deployment-test-environment.md). The existing frontend project is retained; a separate Vercel Express API is prepared in `giftlink-backend/index.js` with cached initialization, safe JSON readiness, unchanged security checks and no startup DDL/seeding. A host-scoped frontend proxy configuration can be generated for review without automatically changing Production.

Normal PR CI now runs desktop/mobile Chromium against the production build and a real hosted-runtime Express API with an owned disposable MongoDB replica set. It covers two-account registration/login/logout, secure cookies, discovery, plan/inventory, pickup acceptance/cancellation/completion/no-show, authorization and frontend-only recovery. Run `npm --prefix e2e ci`, finish the frontend production build, then `npm --prefix e2e test` to reproduce where prerequisites exist.

It also checks anonymous home/discovery/login/register with axe WCAG A/AA rules
and keyboard skip/menu focus on desktop/mobile. These checks remain local and do
not increase remote E2E data budgets; manual assistive-technology/mobile acceptance
is still required. Hosted `/api/live` is cheap liveness; `/api/health` retains DB
readiness/fingerprint verification. API responses include server-generated
`X-Request-Id`; failure diagnostics omit private fields. Frontend waits are bounded
at 15 seconds; refresh to verify an interrupted write before resubmitting.

The manual remote workflow uses the existing `isolated-e2e` Environment without requiring a Required Reviewer. Only the repository owner `hhdg1515` may dispatch or rerun it, on `main`, with the exact reviewed commit SHA; run/cleanup also need the existing target confirmations. See the [single-owner authorization model and limitations](docs/hosted-staging-integration.md#single-owner-e2e-authorization). It never provisions Atlas, creates remote indexes, seeds demos or automatically deletes remote data. Repository/CI checks do not establish hosted E2E success.

Database setup has its own [manual staging preparation workflow](docs/deployment-test-environment.md#prepare-staging-indexes-through-github-actions). It uses only the `isolated-e2e` environment secret `E2E_MONGO_URL` and variable `E2E_DB_NAME=moveout_e2e_staging`; no frontend origin is required. Start with its default **dry-run**, review the live target/fingerprint and create/keep operations, then obtain explicit approval before a separate **apply** run. Existing CI and the HTTPS E2E workflow remain separate.

For Milestone 5.7, follow [hosted staging integration](docs/hosted-staging-integration.md): a stable Preview alias on the existing frontend project, host-conditional proxy, dedicated staging API origin update, approved-fingerprint HTTPS preflight, bounded desktop/mobile E2E and owned cleanup. The optional deployment workflow defaults to **plan**; its management token stays in GitHub. The existing frontend Production hostname is forbidden as a staging/E2E target. API readiness and successful index preparation do not establish hosted frontend or live E2E success.

## Private pickup communication (Milestone 6.2)

The backend associates one private context with each existing pickup request;
the pickup request detail includes a private conversation panel. Authenticated participants can retrieve
`GET /api/pickup-requests/:requestId/conversation`, read paginated
`GET .../conversation/messages?limit=20&before=<cursor>`, and send
`POST .../conversation/messages` with `{ "text": "..." }` using the existing
session and Origin/CSRF headers. Messages are 1–2000 plain-text characters;
history defaults to 20, at most 50, messages per page. Each page is chronological,
and `nextCursor` retrieves the older page to prepend.

Eligible pending/accepted requests allow messaging. After completion, cancellation,
decline or no-show, both original participants retain read-only history access;
no new messages or lifecycle changes are permitted. Deleted requests, missing or
compromised references, changed ownership and nonparticipants expose no history.
Messages stay with their original request and never transfer to a later request
for the same item. See the
[eligibility, closure policy, data model and limitations](docs/milestone-6.2-communication.md).

The new required `pickup_messages_request_time` index uses the existing guarded
`db:prepare` dry-run and explicit target/environment/fingerprint confirmation.
Prepare it on a separately approved target before any future deployment of this
revision; startup checks indexes and will fail readiness until it exists.
No remote index creation, migration, seeding or deployment is part of this change.
The existing recursive backend CI tests and `npm run test:integration` cover the
new endpoints on isolated local replica sets. This does not verify hosted messaging. The panel uses manual refresh and bounded
history pages, keeps drafts only in memory, and offers read-only history after
closure. See the [Phase 2 behavior and local evidence](docs/milestone-6.2-communication.md#phase-2--embedded-pickup-conversation-ui).

## Pickup rescheduling (Milestone 6.2 Phase 3)

An accepted pickup can have one pending time-change proposal. Either original
participant can propose; only the other can accept or decline. The existing
confirmed appointment stays in effect until a valid acceptance. Every operation
uses the pickup's current version and the existing plan transaction; new times
reuse the explicit IANA/DST, local-window and UTC deadline rules. No separate
calendar, new database index or chat-authored scheduling state is introduced.

Current confirmed appointments must still be future to propose or accept a change.
Cancellation/handoff/no-show and confirmed withdrawal/plan closure invalidate any
pending proposal. Window edits that invalidate only the proposal clear it while
retaining a valid confirmed appointment. Terminal requests cannot reschedule.
The request detail distinguishes confirmed and proposed times, offers role-safe
responses, and keeps the existing chat intact through canonical reloads.
See the [state machine, API and rollout boundaries](docs/milestone-6.2-rescheduling.md).

## Communication security and readiness (Milestone 6.2 Phase 4)

Successful messages share MongoDB account quotas of 30 per minute and 300 per
hour across conversations, sessions and instances. Windows start on the first
send after expiry. Existing process-local attempt limits remain; they do not
provide a global GET/auth/scheduling limit or stop mass account creation. Quota
429s keep the draft and provide `Retry-After`; POSTs are never automatically retried.
No new index, service, dependency, migration or message deletion is added.

See the [prioritized audit, proposed privacy/retention policy, workload estimates
and future approval checklist](docs/milestone-6.2-security-readiness.md).
The proposed 90-day closed-message retention is **not implemented or approved**;
currently no automatic message deletion occurs. The Phase 1 message index still
requires separately approved remote preview/apply before deployment. Verification
is local/CI only; hosted chat/rescheduling and public launch are not certified.

## Location-first discovery and classification (Milestone 6.3)

The single backend catalog serves all 50 U.S. states plus DC and 50 curated
metros (expanded additively in 6.4C) using documented Census FIPS/CBSA identifiers. Metro membership is pinned
to **2021 Census geography**, with its source commit/hashes recorded; this is
limited, dated coverage, not every city or current OMB boundaries. Unsupported
areas can retain a state and city/neighborhood on a plan with no metro assignment.
No city guessing, GPS permission, maps, geocoding or external search is used.

`GET /api/regions` and `GET /api/item-taxonomy` provide display labels and stable
IDs. Six household groups contain 28 item types; four optional conditions stay
separate. Other Household → Other and Uncategorized/Not specified are available.
Legacy category values, international/free-text location labels and all 16 demo
gifts are preserved. Only an explicit owner edit assigns an older plan to a
metro, with existing pickup-cancellation confirmation when necessary. A curated
zone suggestion fills only a blank field; existing explicit zones remain intact.

Discovery stores only `{ stateId, metroId }` in the browser-local preference
`moveout.browse-region.v1`; explicit URL selections win. Storage failure is
recoverable, Clear filters retains the region, and browsing changes never PATCH
a plan or account. Preferences are browser-wide, not account-synchronized.
Direct public item links and the separate legacy `/api/gifts` collection/search
remain usable without selecting a metro. New discovery requires paired frontend
and backend support; older unscoped clients must supply the region and refresh
old cursors. Missing/malformed service data is an error, never an empty count.

Before any future hosted rollout, separately approve guarded preparation of
`plan_metro_discovery` and any missing `pickup_messages_request_time` index on
the verified target. Startup never creates indexes or seeds/migrates records.
The existing GitHub staging preparation workflow supports this preview/apply
sequence using its secure Environment; frontend origin is not a DB-preparation
prerequisite. No remote preview, index change, deployment or hosted E2E was
performed for this milestone.

See the [architecture, source vintage, compatibility and review order](docs/milestone-6.3-discovery.md).

## Milestone 6.4A: interface foundation

The [UI/UX audit and tool assessment](docs/milestone-6.4-design-audit.md),
[design tokens and reusable components](docs/design-system.md), and
[6.4B–6.4E proposal](docs/milestone-6.4-roadmap.md) define a gradual interface
refinement using existing React/CSS. Initial screen adoption is limited to Login
and My Plans in a dependent PR; remaining screens and business rules are preserved.
[Before/after evidence and verification](docs/milestone-6.4a-verification.md) use
disposable local data. No hosted verification,
deployment or provider/database preparation is authorized by these changes.


## Milestone 6.4B: listing and inventory refinement

See the [behavior audit, publication compatibility, timezone/status model and
actual desktop/mobile evidence](docs/milestone-6.4b-listing-inventory.md). Normal
CI and disposable local HTTPS checks cover this change; no hosted E2E, remote
migration/index preparation, manual deployment or provider change is performed.
New publication clients must supply complete details. Legacy stored posts remain
readable/editable and no region/category/timezone is guessed or migrated.


## Milestone 6.4C: geographic coverage and discovery

[Source verification and the complete 50-metro selection](docs/geographic-directory.md)
retain the existing 2021 Census geography and every original plan assignment.
Coverage spans 41 states plus DC; unsupported states remain understandable.
Compact display labels do not change official CBSA names or boundaries. New
zone suggestions extend only the existing California policy, never explicit
owner settings.

Find Free Items now uses the shared design system. Category is immediately
available; dependent item type appears on narrow screens when relevant, and
Filters reveals pickup/sort/condition/city/neighborhood without a modal. Desktop
shows common filters directly. Clear filters is offered when needed and retains
the area. Cards show only actual metadata and a detail link; public owner labels
remain server-derived. Counts disappear during failed/loading results, stale
pages offer recovery, and changed pagination totals refresh the eligible set.
No client-side download-all filtering, GPS, paid geography or image upload exists.

[Audit, before/after evidence, dependency order and verification limits](docs/milestone-6.4c-discovery.md)
distinguish isolated local/CI checks from hosted or production readiness. Review
order is **#49 → #50 → #51 → #52 (coverage) → #53 (layout) → #54 (cards/states)**.
Nothing is merged or deployed automatically.


## Milestone 6.4D: pickup coordination experience

Request cards offer **View request** and **Open conversation** using the existing
request ID. Status/cursor URLs and role-derived return links retain list context.
Detail separates request status, pickup arrangement, private conversation and
collapsible history. Pending/Accepted/Completed/No-show labels preserve canonical
backend states; accepted is a reservation, not a handoff.

Messages retain chronological bounded history, Load earlier, manual Refresh,
reading position, multiline Enter, explicit Send and memory-only draft guards.
Message timestamps use device time; pickup timestamps use the stored giver zone.
Existing 429 quota delay metadata supplies a bounded suggested wait. Uncertain
sends/proposals require successful explicit revalidation and review before any
manual retry; no POST is automatically repeated.

Formal proposals remain separate from chat, retain the confirmed appointment,
attribute the proposer and allow only server-authorized responses. Conversation
entry retains item context and links an existing time proposal back to the same
arrangement section. **Reload request** refreshes lifecycle/scheduling;
**Refresh conversation** refreshes messages. Neither silently drains history.
Chat and scheduling drafts remain independent through conflicts and closure.

[Audit, actual before/after evidence, privacy/compatibility and verification](docs/milestone-6.4d-pickup-experience.md)
also documents the explicitly deferred server-backed unread design. No unread
badge/read receipt, polling, new conversation entity, persistent draft, message
attachment or retention change is implemented. Review/merge prerequisites remain
**#49 → #50 → #51 → #52 → #53 → #54 → #55 → #56 → #57**;
nothing is merged or deployed automatically.

## Milestone 6.4E: integrated MVP acceptance

The [acceptance report and actual desktop/mobile evidence](docs/milestone-6.4e-acceptance.md)
review merged 6.4A–6.4D with independent giver/requester sessions, real local APIs,
disposable replica sets and the production frontend build. The
[human testing checklist](docs/milestone-6.4e-human-checklist.md) gives local startup
and two-session steps. Known validation/form-layout debt and public-launch gates
remain explicit; local/normal CI success is not hosted or production readiness.
No feature, dependency, schema, provider configuration or remote data change is
part of this acceptance package.

## Private photo storage preparation (6.5B1)

Photos remain disabled and the application is unchanged. Local S3 contracts now
use an official, digest-pinned **SeaweedFS** fixture; MinIO is banned. Future
production storage remains private **Cloudflare R2**, with no remote activation.
See [B1 setup, isolation and verification status](docs/milestone-6.5b1-storage.md)
and the [artifact/security review](docs/milestone-6.5b1-seaweedfs-review.md).

## Owner photo metadata and quotas (6.5B2)

[B2 API, schema, quota and rollout notes](docs/milestone-6.5b2-photo-metadata.md)
describe the metadata-only foundation. Owner endpoints default **off** behind
`ITEM_IMAGE_METADATA_ENABLED=false`. Reservations never upload/process files or
make images ready; no photo UI or public/binary image endpoint exists.

**Safe disabled rollout:** when `ITEM_IMAGE_METADATA_ENABLED` is unset or `false`,
startup checks all 12 previously required application indexes and does not inspect
`itemImages` indexes. Existing databases need no photo schema change to run with
metadata disabled. Startup remains read-only; metadata routes and storage stay off.

**Before enabling metadata:** prepare all four compatible `itemImages` indexes
using the existing `db:prepare` dry-run and exact database/environment/fingerprint
approval. Explicit preparation always checks the complete registry, regardless of
the feature flag. Enabled startup fails closed on missing/incompatible photo
indexes. Remote preparation requires separate owner approval; this change performs
no Atlas or R2 operations. Enabling metadata never enables binary uploads.

`npm --prefix giftlink-backend run test:images` runs owner authorization,
idempotency, quotas, expiry, ordering and two-instance transaction tests on an
owned disposable local replica set. Normal `npm test` and CI include them and the
unchanged B1 real SeaweedFS contracts. Pilot quotas are provisional ceilings,
not approved production limits. B3/B4 add local processing and recovery below;
deployed activation remains separately gated.

## Secure local photo pipeline (6.5B3)

The [B3 implementation, security review and measurements](docs/milestone-6.5b3-image-pipeline.md)
cover real JPEG/PNG/static WebP intake, Sharp sanitization, fenced two-variant
storage/finalization and current-authorized GET/HEAD. All production binary routes
remain disabled: `ITEM_IMAGE_PIPELINE_ENABLED=true` is refused, including after B4.
Only a live-verified disposable local SeaweedFS configuration can inject the
pipeline for tests. Metadata flags do not activate uploads or photo delivery.

From the repository root, with Node 22 and a local Linux/amd64 Docker engine:

```sh
npm --prefix giftlink-backend run test:images:pipeline
npm --prefix giftlink-backend run test:images:resources
```

Tests own their MongoDB/SeaweedFS resources and clean them using existing receipt
guards. Resource probes generate images in memory and perform no DB/S3 writes.
The existing CI runs all backend/native contracts and the full local HTTPS suite,
including two-account browser photo isolation; hosted photo fixtures are refused.
No photo UI, public bucket, R2 configuration, cleanup/retention job or launch
activation is included. Physical recovery is described below; frontend work and
separately approved hosting/storage rollout remain mandatory before real uploads.

## Local physical photo cleanup and recovery (6.5B4)

[B4's operator procedure and failure policy](docs/milestone-6.5b4-photo-recovery.md)
cover exact-key deletion, unknown-write holds, durable leases/tombstones and
exact-once accounting. With Node 22 and the existing local Docker engine:

```sh
npm --prefix giftlink-backend run test:images:recovery
```

`npm --prefix giftlink-backend run images:reconcile -- ...` has separate dry-run
and explicitly confirmed apply modes. Both require private ownership receipts
for **disposable local MongoDB and SeaweedFS**, exact database/environment,
provider/bucket/namespace identities, and apply additionally requires both target
fingerprints and the reviewed manifest digest. See the linked procedure for
complete arguments, bounds and safe shutdown. No `.env` or remote URI fallback.
No scheduler, retention purge, R2 access, Atlas write, production activation or
photo UI is introduced. Unknown PUTs remain charged when their outcome cannot
be established; a temporary missing object never authorizes a refund.

## Owner photo selection and upload (6.5C1)

The [C1 interaction, transport and verification notes](docs/milestone-6.5c1-owner-photo-upload.md)
describe optional photos inside Add/Edit item and ready thumbnails on the owner
inventory card. **Publish with N photos** / **Save draft with N photos** explicitly
authorizes one save-then-upload workflow. The real item ID comes first, followed
by bounded sequential uploads; there is no second initial Upload confirmation.
Item save/publication remains successful if photos fail. Item-scoped status checks
and **Upload remaining N photos** recover eligible files without recreating items
or automatically replaying uncertain PUTs. A consumed submit intent cannot replay
on refresh/remount. An uncertain create requires explicit inventory review.

Creation fields close after save; Add item starts another. Text/photo drafts are
independent. In-app photo loss uses **Stay and keep photos** / **Leave and discard
photos**, with native protection for actual tab reload/close. Unsent files live
only in this tab. Browser preparation accepts supported sources up to 20 MiB/48 MP
and sends a new derivative within the unchanged 3 MiB cap; Sharp remains
authoritative. HEIC needs JPEG export. Reorder/cover/deletion and public galleries
remain deferred.

Deployed binary upload/read gates stay **disabled**. The UI requires actual
server capabilities; metadata-off/binary-unavailable servers show disabled
controls. Real uploads run only through the existing verified disposable local
MongoDB + SeaweedFS pipeline injection. No new frontend flag enables production
uploads, creates indexes or selects a remote provider. The normal local/CI suites
include the new native/frontend/HTTPS photo cases and existing lifecycle tests.

Owner item classification uses a searchable type selector with automatic category
assignment. See [classification UX and compatibility](docs/item-classification-ux.md)
for the additive catalog, Other/custom validation and local visual evidence.

[Owner photo management (C2)](docs/milestone-6.5c2-owner-photo-management.md)
introduced the existing versioned ordering/deletion APIs inside Edit Item. UX-1
keeps deletion in the UI and preserves existing server order while removing visible
reordering controls. Logical deletion and physical cleanup remain separate;
production image gates stay disabled.

## Public item covers and gallery (6.5D1)

[Public photo contracts, privacy, query bounds, verification and rollback](docs/milestone-6.5d1-public-photos.md)
describe optional thumbnail covers on discovery cards and ordered detail galleries.
They reuse authorized application delivery and C2's first-Ready cover order. Photo
failures preserve item information and real listing counts. Private buckets,
revocation checks, quotas and default-disabled production gates remain unchanged;
no remote migration or storage activation occurs on merge.

## Pickup request item thumbnails (6.5D2)

[The D2 authorization matrix and implementation notes](docs/milestone-6.5d2-pickup-photos.md)
describe compact current-cover thumbnails in request creation/detail. Request
participation and historical chat do not grant private-photo access: requesters
retain only current public-item access; valid owners retain existing owner access.
Lists add no photo queries, failures preserve request information/actions, and
existing production photo gates remain default-disabled. No remote migration.

## Integrated photo acceptance (6.5E1)

[The E1 acceptance report](docs/milestone-6.5e1-photo-acceptance.md) records the
B1–B4/C1/C2/D1/D2 lifecycle, actual desktop/mobile evidence, full regression
gates, dependency/native resource measurements and P0/P1/P2 follow-ups. Local
acceptance does **not** authorize production uploads: E1 evidence uses local
fixtures, and hosted photos remain gated. [The separate production-readiness checklist](docs/photo-production-readiness-checklist.md)
requires explicit resource, index, provider, recovery, hosted/device and rollout
approvals. No production configuration, Atlas/R2 resource or live E2E is changed.

## Private R2 architecture (6.5F1)

[F1 transport/recovery architecture](docs/milestone-6.5f1-r2-architecture.md) adds
separate signed R2 target configuration, role-limited object transport, a sealed
runtime pipeline with independent upload admission and an explicitly approved
operator recovery CLI. The local SeaweedFS receipt verifier remains mandatory.
Ordinary server startup still refuses R2/pipeline activation; all production photo
gates remain disabled. See [the separate rollout checklist](docs/photo-production-readiness-checklist.md)
and [configuration-only template](giftlink-backend/.env.r2.sample). No real-provider
compatibility, hosted photo E2E or production readiness is inferred from local tests.

Run `npm --prefix giftlink-backend run test:storage:r2` for the synthetic protocol /
verified local MongoDB, SeaweedFS and Sharp regressions. `images:r2:approve` is an
offline signing operation; `images:r2:reconcile` has separate dry-run/apply and exact
confirmations. These commands are not permission to access remote resources.

## Dependency and photo-capacity hardening (6.5F2)

[The F2 audit/capacity report](docs/milestone-6.5f2-security-capacity.md) records
before/after advisory inventories, browser/build/test reachability assumptions,
scoped compatible dependency fixes and remaining risks. Frontend audit still exits
nonzero; affected package counts are not confirmed application vulnerabilities.

Photo uploads now use ticket-scoped clients, preserving the per-client key guard
and durable replay protection without a warm-pipeline lifetime ceiling. User
quotas, unknown holds and the 1,000-record cap are unchanged. [Retention/archival/erasure](docs/photo-operation-retention-proposal.md)
is a decision proposal only; no pruning, migration or production activation occurs.
Run `npm --prefix giftlink-backend run test:capacity` and
`npm --prefix giftlink-frontend run test:dependencies` alongside the complete suites.

## Photo operations and readiness (6.5F3)

[F3's operational audit](docs/milestone-6.5f3-photo-operations.md),
[operator commands and recovery decision matrix](docs/photo-operations-runbook.md),
and [separate hosted-trial approval checklist](docs/photo-hosted-trial-approval.md)
distinguish verified local behavior from untested provider assumptions.
`npm --prefix giftlink-backend run images:preflight -- --offline` validates only
local configuration/receipt facts; it never authorizes or contacts a provider.
`images:operations -- --local ...` uses both existing ownership receipts and
reports a bounded read-only local maintenance page, never global totals or
settlement proof. There is no remote/apply mode in either new diagnostic.

As audited in F3, signed authority and upload pauses were worker-local: no fleet switch
or permanent distributed revocation is claimed. Renewal needs fresh contexts and
manifests; old unexpired trust can survive on an unchanged worker. Hosted wiring,
real-provider/restore evidence and an approved stop/revocation procedure remain
blocked prerequisites. Production photo gates, quotas, tombstones, index registry
and all storage/recovery invariants are unchanged. No hosted E2E or deployment
command is part of F3.


## Distributed photo controls (6.5F4)

[F4's design, concurrency evidence and remaining risks](docs/milestone-6.5f4-distributed-photo-control.md)
and [guarded local operator procedure](docs/photo-distributed-control-runbook.md)
add an opt-in signed `photoControls` record, exact target/role receipt binding and
transactional fences. A committed shared pause blocks subsequent durable claims
across participating processes; admitted work, reads and separately authorized
recovery have distinct rules. Two independent OS-process tests exercise actual
MongoDB write conflicts, local SeaweedFS, crashes, rotation and stale authority.

Run `npm --prefix giftlink-backend run test:images:distributed`. The new
`images:control` administration command supports only receipt-owned local fixtures;
`images:control:approve` signs changes offline. Explicit initialization starts
paused and creates only the collection/native `_id_` index; startup does no DDL.
All production flags stay false. Adoption requires stopping all uncontrolled old
workers first. Permanent revocation across restored databases, hosted wiring,
remote administration and real-provider compatibility remain unverified/blocked;
no production activation, migration, remote E2E or deployment is authorized.


## Coordinated photo recovery acceptance (6.5F5)

[F5 recovery evidence and P0/P1/P2 limits](docs/milestone-6.5f5-coordinated-recovery.md)
and the [restore decision matrix/runbook](docs/photo-disaster-recovery-runbook.md)
exercise independent DB/object snapshots, tombstones, unknown holds, session
invalidation, ownership and F4 rollback using private local fixtures and independent
OS workers. Run `npm --prefix giftlink-backend run test:images:restore`.

Unsafe recovery keeps a full photo outage; fresh reviewed grants restore only
reads, never automatic uploads. The harness is not a production restore service
or independent rollback-resistant trust authority. Production gates remain off.
The [dependency checkpoint](docs/milestone-6.5f5-dependency-checkpoint.md) reproduces
352 cached versus 67 fresh-cache package entries with identical direct advisories,
locks and frontend source. No packages, infrastructure or provider settings change.

## Milestone 6.6 UX-1: item-centered interactions

[Behavior, compatibility, actual desktop/mobile evidence and UX-2 dependencies](docs/milestone-6.6-ux1-item-centered.md)
cover the top-positioned Add item form, direct owner editing, ranked type search,
minimal photo controls, always-visible discovery filters and request cleanup.
No plan migration, production photo activation or infrastructure change is included.

## Milestone 6.6 UX-2A: item-first architecture proposal

[Item-first data model, compatibility, migration and UX-2B/UX-2C sequence](docs/milestone-6.6-ux2a-item-first-architecture.md)
are design proposals for review. No item-first runtime, migration, index change or
production activation is implemented or authorized by this documentation PR.

## Milestone 6.6 UX-2B1: disabled dual-model backend foundation

[Context, deadline policies, transaction fences and rollback](docs/milestone-6.6-ux2b1-dual-model-foundation.md)
describe internal v2 helpers and fail-closed legacy route guards. Independent
creation/publication, media, requests and migration remain unavailable pending B2/C.

UX-2B2 adds default-disabled private independent-listing APIs and a guarded owner-feed
index. See [API, preparation and rollback contracts](docs/milestone-6.6-ux2b2-independent-listing-api.md).

## Milestone 6.6 UX-2B3: private Item-first frontend

**My Listings** is the primary owner destination. Owners can create a name-only
independent draft, view its private detail and edit its own classification,
location and explicitly confirmed pickup timezone/deadline. Legacy inventory and
authorized plan-based edits remain available through an explicit compatibility link.

The existing `OWNER_LISTINGS_ENABLED` gate remains **false by default**. A disabled
API shows a recoverable unavailable state; it never creates a plan as a fallback.
Enabling the private API later requires separately approved preparation of the
existing `items_owner_created` index. This milestone does not authorize remote
preparation or activation. V2 publication, photos, pickups and messaging remain off.

See the [implementation, verification evidence and rollback report](docs/milestone-6.6-ux2b3-item-first-frontend.md).
Public v2 publishing, photos and pickup requests remain unavailable.
