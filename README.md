# GiftLink — Pickup Coordination

GiftLink remains a React, Express, Node.js, and MongoDB native-driver application. Milestone 5 adds private two-party pickup requests, giver-controlled acceptance, appointments, cancellations, handoffs and no-shows. Anonymous neighborhood discovery, plan inventory and authenticated ownership remain intact. Public GiftLink browsing/search and all 16 demo records remain separate and unchanged. Messaging, notifications, payments, shipping, property integrations, image uploads, and geographical APIs are not implemented.

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
- Non-unique `items` indexes on `{ planId: 1, ownerId: 1, createdAt: 1, _id: 1 }` and `{ status: 1, publishedAt: -1, _id: -1 }` for management and public discovery.
- Non-unique `items_pickup_start` on `{ status: 1, availableFrom: 1, publishedAt: -1, _id: -1 }` for pickup-start filtering during discovery.
- Four `pickupRequests` indexes: `pickup_received` on `{ giverId: 1, _id: -1 }`, `pickup_sent` on `{ receiverId: 1, _id: -1 }`, unique `pickup_one_accepted` on `{ itemId: 1 }` **only where `status: "accepted"`**, and unique `pickup_active_receiver` on `{ itemId: 1, receiverId: 1 }` **only where `active: true`**. Exact partial predicates and binary collation are checked on startup/preparation; a broader/different predicate is incompatible.

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

Select **My Plans** in the navigation and sign in. `/app/plans` lists your plans in deadline order; create directly at `/app/plans/new`. Each plan links to a detail view and an edit form. Creation needs only a deadline, city, and neighborhood; the title is optional. You may create multiple plans. There is no address, tenancy, HOA, item, or mapping requirement, and no multi-step onboarding.

All plans are private to their owner. The interface supports session checks, loading, an empty dashboard, field validation, retries, save progress, and expired-session login prompts. Unsaved edits survive background validation of the same account. Private fetched data is discarded when switching accounts/routes, and stale requests cannot replace the current account's data.

### Model and date policy

`moveOutPlans` stores:

| Field | Meaning |
| --- | --- |
| `_id` | MongoDB ObjectId, returned as string `id`. |
| `ownerId` | Account ObjectId derived from the authenticated session. Never accepted from the caller or included in plan responses. |
| `title` | Optional trimmed single-line text, at most 120 characters; omitted/cleared titles are stored as `""`. |
| `moveOutDeadline` | Required real calendar date, exactly `YYYY-MM-DD`, stored as a string. |
| `city`, `neighborhood` | Required trimmed single-line labels, 1–100 characters each. Free text; no external lookup or location taxonomy. |
| `status` | Created as `active`; owners may edit to `active`, `completed`, or `cancelled`. |
| `createdAt`, `updatedAt` | Server-generated BSON dates, serialized as UTC ISO timestamps. Creation time is immutable. |

Deadlines represent calendar dates, without a pickup time or timezone conversion. New plans and changed deadlines must be today or later using the current **UTC date** on the backend; the form explains and follows that boundary. Impossible dates, timestamps, offsets, scalar-type mismatches, and unsupported fields are rejected. Date display explicitly preserves the calendar day across browser timezones.

Passing the deadline does not automatically change status, hide, or delete a plan. Owners may still edit its other details, keep its unchanged past deadline, or select a new current/future deadline. Status changes are manual and reversible; there is no speculative workflow or automatic item lifecycle. A later product decision may adopt a neighborhood timezone or a precise deadline time, which would require an explicit model/validation change.

### Private plan API

All endpoints require the existing valid session cookie; writes also require the existing Origin/CSRF/JSON protocol. Responses use `Cache-Control: no-store`.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/move-out-plans` | `{ moveOutDeadline, city, neighborhood, title?, pickupTimeZone? }` → `201 { plan }` plus a Location header. Ownership, status, and timestamps are server-derived. |
| `GET /api/move-out-plans` | `200 { plans: [...] }` for the current owner only, sorted by deadline then ID. Query parameters cannot select another owner. |
| `GET /api/move-out-plans/:id` | `200 { plan }` for an owned plan. |
| `PATCH /api/move-out-plans/:id` | Nonempty partial update of title/deadline/city/neighborhood/status/pickupTimeZone, optional `confirmCancelRequests` → `200 { plan }`. |

A plan DTO contains only `id`, `title`, `moveOutDeadline`, `city`, `neighborhood`, `pickupTimeZone` (null when unset), `status`, `createdAt`, and `updatedAt`. Private contact, address, password, and session fields are excluded by database inclusion projections and response serialization. Read and update queries include both the plan ID and the authenticated owner ID; updates never trust a supplied owner. Missing, malformed, and other users' plan IDs share `404 PLAN_NOT_FOUND`. Validation uses `400 VALIDATION_FAILED` with field messages without submitted values. Missing/expired sessions use `401`; invalid write origins use `403`.

Each plan can now have any number of incremental items, including zero. Plan editing never copies location/deadline into item documents. A shorter deadline that conflicts with item overrides returns `409 ITEM_DATE_CONFLICT` with the affected owned item IDs/names/dates. The edit form leaves the proposed plan unchanged, links to those item editors in new tabs, and keeps its draft. Explicitly edit/clear the overrides or choose another deadline, then retry. There is no silent date truncation or bulk account/data repair.

## Inventory workflow and item API

From plan detail choose **Manage items** (`/app/plans/:id/items`). Enter only an item name, then **Save draft & add another** or **Publish & add another**. The name resets and regains focus for quick repeated entry. Optional details are collapsed initially: description (2,000 characters), free-text category/tag (80), and pickup dates. Names allow 1–160 characters and may describe grouped belongings or multiple identical objects. No furniture taxonomy, brand, condition, dimensions, weight, price, or image is required.

The inventory shows each state, effective date window, status filtering, and cleared/total progress. Progress counts item records/groups, rather than the number of physical objects inside a group. Unlisting does not count as clearing. Actions use confirmation prompts; editing a live listing confirms its immediate public change. A failed save retains the draft. Stale versions request an inventory reload rather than overwriting another tab's change. Refreshing an open edit asks for confirmation and replaces outdated values with current saved details before adopting a newer version. No normal action deletes records. Clearance reasons are not collected in this milestone.

| Item field | Meaning |
| --- | --- |
| `_id`, `planId`, `ownerId` | ObjectIds; server derives the owner and verifies the owned parent for every management operation. Items cannot be moved between plans through the API. |
| `name`, `description`, `category` | Required free-text name and optional plain-text description/tag. Unknown fields, markup, control characters, and ownership/location/price spoofing are rejected. |
| `availableFrom`, `availableUntil` | Optional `YYYY-MM-DD` strings or `null`. Empty fields become `null`; shared location/deadline are never duplicated. |
| `status` | Stored lifecycle state; the API additionally derives expiry from the effective latest pickup date on every read. |
| `createdAt`, `updatedAt`, `publishedAt` | Server timestamps. `publishedAt` starts as `null` and records the first explicit publication; relisting retains it. It is separate from pickup dates. |
| `version` | Owner-facing optimistic concurrency version, required for edits/actions. Not exposed in public DTOs. |

Effective earliest pickup is the explicit `availableFrom`, or **immediately** when omitted. Effective latest pickup is `availableUntil`, or the current plan deadline when omitted. Validate an explicit start against the effective end, and require `end <= plan deadline`. Publishing/reopening additionally requires `end >= today (UTC)`. The end date is inclusive. Historical drafts, withdrawn items and cleared items can retain past dates for recordkeeping. All date inputs remain calendar strings and use the existing UTC comparison policy.

Future pickup starts do not delay publication: a published listing is offered now, with its future pickup window clearly displayed. `publishedAt` means first public visibility, not a pickup appointment. Date-only discovery retains UTC comparisons; explicit appointment timezones are described below.

| State/action | Behavior |
| --- | --- |
| Create draft | Private; defaults to `draft`. Can be edited or cleared. |
| Publish/relist | Draft, unlisted, or expired → `available`, after date/policy checks and verification that the plan is active. |
| Unlist | Available/expired → `unlisted` immediately; no reason required, no progress increment. |
| Mark cleared | Any non-cleared state → `cleared`; public visibility ends and clearance progress increases. Any external clearance channel is allowed. |
| Reopen as draft | Cleared → private `draft`, after valid-current-date checks. Progress decreases; publish separately when ready. |
| Expiry | Available items whose effective end is before today are returned as `expired` and excluded from public reads without a scheduler. |

Editing an expired item's dates keeps it expired until explicit publication. A plan edit persists already-expired available items as `expired` before extending its deadline, so extending a plan cannot silently republish them. First publication time is preserved. Deactivating a plan hides its available items; explicitly reactivating the plan restores still-valid available items. Unlisted/cleared/draft/expired items remain private.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/move-out-plans/:planId/items` | Private plan context, items and `{ total, cleared }` progress. |
| `POST /api/move-out-plans/:planId/items` | `{ name, description?, category?, availableFrom?, availableUntil?, publish? }` → `201 { item }`. `publish` is an explicit boolean intent; default false. |
| `PATCH /api/move-out-plans/:planId/items/:id` | Partial item details plus numeric `version` → `{ item }`. No ownership, status, price or shared-location changes. |
| `POST /api/move-out-plans/:planId/items/:id/actions` | `{ action: "publish" | "unlist" | "clear" | "reopen", version }` → `{ item }`. |
| `GET /api/items` | Anonymous filtered, sorted and cursor-paginated discovery; see below. |
| `GET /api/items/locations` | Public city/neighborhood options, derived exclusively from visible listings. |
| `GET /api/items/:id` | Anonymous detail only while currently publicly offered; unavailable/nonexistent/malformed IDs all return 404. |

Both item ownership and parent-plan ownership are required; mismatched/orphaned records cannot leak through management or public joins. All writes reuse sessions, Origin/CSRF/JSON requirements, bounded validation and safe error handling. `409 ITEM_CHANGED` rejects stale versions. Multi-document transactions touch the parent on **every** plan/item mutation, preventing concurrent deadline edits and item writes from committing incompatible data. Driver retries revalidate against a fresh snapshot. Public reads use snapshot aggregation joining the current plan and check matching ownership, active plan, publication, available state and effective end/range. The collection has no TTL index or automatic record deletion.

**Free items** (`/app/items`) demonstrates public search/detail separately from legacy Gifts. Public DTOs allowlist name, description, category, safe general location, pickup dates, deadline, state and first publication timestamp. Owner IDs, parent IDs, versions, email, contact/address fields, hashes and tokens are excluded. Responses and fetches use no-store; public pages refresh on focus or explicit refresh. Previously downloaded public text cannot be revoked, and an already-open page needs a refresh to reflect withdrawal.

Publication blocks obvious restricted-goods keywords and email patterns, and the form requires safe, lawful household goods with no contact/address details in public text. This narrow, conservative filter is **not complete content moderation**: it can miss obfuscated or other prohibited goods and private details, and can reject harmless matching text. There is no automated safety guarantee, reporting/review system or external moderation service yet. Those controls and marketplace abuse handling need design before public launch; there is no claim that plain-text validation makes listings safe.

## Anonymous neighborhood discovery

Open **Free items** (`/app/items`) without registering, signing in, or selecting a location. Search names, full descriptions and optional tags, choose a city and/or neighborhood, filter pickup availability, and sort by newest publication or earliest effective pickup deadline. Location labels are approximate public text; they do not restrict who may browse or eventually receive an item. There is no location tracking, GPS permission, map, geocoder or external search provider.

City/neighborhood selectors are populated from currently public listings and deduplicated after whitespace normalization and case-insensitive comparison, including common Unicode whitespace/case variants. Choosing a city narrows neighborhood suggestions and clears a previous neighborhood selection. With All cities, a neighborhood label searches across cities. A city can be selected without a neighborhood. Raw stored plan labels are preserved; comparison/display normalization happens at read time.

Filters and sort order are stored in URL query parameters, so filtered pages can be shared and browser Back works normally. Changing filters restarts pagination, and late responses from an earlier query cannot replace new results. **Load more** appends the next server page and deduplicates IDs. Loading, empty, retry and expired-cursor states have explicit controls. Location-option failures have an independent retry and do not block general browsing. Focus/Refresh rechecks current publication visibility and restarts the first page while retaining filters.

Cards show name, optional category, general location, **Available Now** or **Available Later**, earliest pickup when specified, and effective latest pickup. Details include the full description, first publication date, and a read-only direct URL with Copy link/manual-copy fallback. Links work anonymously. Cards use text; no photos are fabricated and no fake reservation/pickup control is provided.

### Query and availability contract

`GET /api/items` accepts only these single-valued parameters:

| Parameter | Meaning/default |
| --- | --- |
| `q` | Optional literal phrase across name, description, or category. Case-insensitive; whitespace collapses. Maximum 100 input characters; regex operators are escaped. |
| `city`, `neighborhood` | Optional exact labels after whitespace/case normalization. Each at most 100 input characters. Neither is required. |
| `availability` | `all` (default), `now`, `later`, or `date`. |
| `date` | Required only with `availability=date`: valid `YYYY-MM-DD`, today or later in UTC. Other combinations are rejected. |
| `sort` | `newest` (default) or `deadline`. |
| `limit` | Canonical integer 1–50; default 12. This is a per-page bound, replacing the old total 50-result cap. |
| `cursor` | Opaque continuation from the previous page; retain the same filters, sort and page size. At most 1,024 characters. |

Unknown parameters, repeated/array/object values, oversized text, invalid dates, excessive page sizes and unsupported sort/filter modes return `400 INVALID_DISCOVERY_QUERY`. Text errors never echo submitted values. `GET /api/items/locations` accepts no query parameters.

Each feed response is `{ items, today, page: { limit, hasMore, nextCursor } }`. `today` is the server's UTC calendar date. `nextCursor` is `null` at the end. Item/detail DTOs retain the Milestone 3 public fields and add `availability: "now" | "later"` and `pickupTimeZone` (IANA string or null); detail also returns `today`. Owner IDs, plan IDs, versions, credentials and private fields remain excluded.

**Now** means the explicit start is today/past or omitted; **Later** means an explicit start is after today. General browsing includes both. For a selected date, an item matches only if its start is omitted or on/before the date, and its effective end (`availableUntil ?? plan.moveOutDeadline`) is on/after the date. Boundaries are inclusive. Expired items are excluded even if a caller requests another date. Publication time is never substituted for a pickup start. React displays the API's availability classification and uses UTC-preserving calendar formatting. Changing this existing discovery-date convention to neighborhood-specific dates remains deferred.

## Pickup coordination and handoff

1. The giver explicitly selects **Pickup timezone** in Create/Edit plan, using an IANA identifier such as `America/Los_Angeles`, `Asia/Kolkata`, or `UTC`. No browser, city lookup, environment variable, offset or geocoder supplies a hidden default. Setup is optional for legacy browsing and required to receive pickup requests.
2. A receiver follows **Request pickup** on a public detail link, signs in if necessary, selects a local date/time in the displayed giver timezone, and optionally leaves a private note (500 plain-text characters). Each listing, including a box/group, is one indivisible pickup unit. No residential address is requested. Suggest general public rendezvous instructions rather than personal contact/address details.
3. **Incoming requests** consolidates the giver's requests across all plans; **My requests** shows the receiver's proposals. Filter by status to review accepted appointments. Lists use 25-record pages with Next/First controls. A private detail retains the item's full description after withdrawal/clearance, shows the other party's first name only, appointment timezone, note, status and action history. A receiver never receives private plan title/ID; the giver sees a management link to their own plan.
4. The giver accepts/declines. A pending request never reserves an item. An accepted appointment reserves that entire listing until cancellation, no-show or completion; it is not a recorded handoff. Other pending proposals remain pending. New submissions are blocked while reserved, although public discovery remains available. Cancel a proposal and submit a new one to change its time; no counteroffer/chat is implemented.
5. Either party can cancel; the giver records the actual handoff or a no-show after the scheduled time. Completion clears the item and cancels competing requests atomically. No-show releases the reservation without clearing the item or selecting another receiver. All actions require confirmation and a fresh request version.

### Time semantics

The API accepts a minute-precision local `YYYY-MM-DDTHH:mm` and the plan's explicit `timeZone`. The server uses pinned `@js-temporal/polyfill` with the Node/ICU IANA timezone database, converts with `disambiguation: "reject"`, and stores `proposedAt` as a BSON UTC instant plus `localDateTime` and `timeZone`. Invalid dates, past instants, nonexistent spring-forward times and repeated fall-back times are rejected. Choose a different unambiguous time; callers cannot override ambiguity with a supplied offset. React formats the stored instant in the recorded timezone, even when the viewer's browser uses another zone.

Availability **labels** retain their existing YYYY-MM-DD values. For appointments, the proposed instant's date **in the giver-selected timezone** must fall between explicit `availableFrom` (or immediate) and `availableUntil ?? moveOutDeadline`, inclusive. The instant must also be before **00:00 UTC on the following end date**, preserving the existing global listing expiration. For example, a Los Angeles listing ending July 3 cannot book 11pm local July 3, because it has already expired in UTC; choose an earlier time or extend its dates. This deliberate extra cutoff prevents a future accepted appointment from outliving listing availability. Discovery's Now/Later badges still use the existing UTC date convention, so they describe calendar eligibility rather than a neighborhood's exact current clock time.

Expired listings reject new requests and acceptances. Pending proposals whose time has passed cannot be accepted; either party can cancel or the giver can decline them. Accepted appointments whose time has passed remain available for truthful handoff/no-show reporting, including after date expiry; expiry alone does not falsely record a missed or successful pickup. No background job changes their outcome. Completion/no-show before the scheduled instant is refused. Giver-declared zones can be wrong, and future timezone legislation/ICU updates can change wall-clock rendering: the stored UTC appointment remains authoritative. Location verification, time rescheduling/counteroffers, grace periods and a neighborhood-aware expiry migration need later product decisions.

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

Milestone 6 still needs messaging/contact and rendezvous UX, notifications, moderation/reporting, data retention, no-show grace/dispute handling, timezone verification/rescheduling and production abuse controls. This milestone supplies no exact address, chat, notifications, ratings, payments, shipping or external location service.

### MongoDB pagination, safety and limits

Search, location/date filtering, visibility and sorting run in MongoDB before page limiting. Public aggregation joins the current plan under snapshot read concern and always checks exact available/publication state, matching item/plan ownership, active plan and valid unexpired dates. Location metadata uses the same gate, so private/empty/inactive plans cannot leak location options. Details apply the gate again; draft, unlisted, cleared, expired, unpublished, orphaned or inactive-parent IDs return `404 ITEM_NOT_FOUND`. Direct URLs are not an authorization bypass.

Newest ordering is `(publishedAt DESC, _id DESC)`; deadline ordering is `(effectiveAvailableUntil ASC, _id ASC)`. Keyset comparisons use the last displayed pair, with one extra record to determine `hasMore`; no offset/skip pagination is used for item pages. A continuation binds the normalized query, sort, page size and initial publication cutoff. Publications newer than the first request wait for a refresh. Cursors expire after 15 minutes or at the next UTC date boundary. Changed filters/page size/sort or malformed cursors return `400 INVALID_CURSOR`; expired/day-boundary cursors return `409 STALE_CURSOR`. The UI offers Start again. A withdrawn anchor need not remain public; its key is only a position, and every next-page record passes current visibility checks.

Cursors are versioned base64url JSON containing public ordering keys and a query fingerprint. They are opaque client state, not encrypted secrets, signed capabilities or authentication. A forged position cannot override filters or reveal private records. Pagination is live, not a long-lived historical snapshot: item/plan edits can move records between pages or filters. The client deduplicates IDs; refresh to obtain a complete current ordering after changes. Already downloaded public text cannot be revoked.

The existing publication and parent indexes remain useful; the new pickup-start index narrows now/later/date candidates. Effective deadlines and normalized locations depend on joined plan data and are not duplicated/backfilled into items. Substring/phrase regex search, cross-collection filters and deadline sorts can scan many candidates and do not offer external-search relevance, stemming, accent-insensitive matching or a precomputed location taxonomy. Aggregations have a 5-second execution cap and disallow disk spilling; time/memory limits return `503 DISCOVERY_BUSY`, asking the caller to narrow filters/retry. Public discovery/detail/options share a per-process limit of 120 requests/minute/IP and return `429 DISCOVERY_RATE_LIMIT` with retry guidance. Review proxy/IP configuration and distributed limiting with the chosen host.

Location suggestions are capped at 500 distinct public city/neighborhood pairs with a `truncated` flag. Existing shared/API filters still work outside the suggestion list. There is no global geographic registry or guarantee that free-text labels represent official boundaries. Advanced search/index optimization and larger metadata catalogs are future scale decisions.

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

GitHub Actions runs frozen installs, backend lint and isolated API/identity/plan/inventory/discovery/pickup/preparation tests, frontend account/session/plan/inventory/discovery/pickup tests in a non-UTC timezone, and the strict build on PRs to `main` and pushes to `main`. It uses no application/production credentials and does not deploy.

## Migration and remaining limitations

- Deploy backend and frontend together: old bearer JWTs and `authtoken` response fields are intentionally retired. Everyone signs in again. Browser storage is cleared; existing account password hashes are preserved.
- Review existing email normalization/duplicates and prepare indexes on a confirmed target before starting the new server. No account data has been automatically migrated. Startup is read-only with respect to schema setup.
- The former `db:prepare --confirm-host ...` interface is replaced by preview plus `--apply` and database/environment/fingerprint confirmations. Preparation no longer imports or shares policy with the seed command. Remote execution is available only through the explicit guarded workflow; real provider connectivity, permissions, and topology still require operator verification. No connected remote resources were modified during implementation.
- HTTPS and exact `APP_ORIGIN` are required in production. Review trusted proxy configuration with the chosen host before enabling client-IP forwarding; blindly trusting forwarding headers is unsafe. The current limiter is per process, not distributed.
- Legacy bcrypt hashes consider only the first 72 bytes of overlong passwords. A future reviewed password-reset/rehash strategy can retire this compatibility behavior; existing accounts are not silently rewritten.
- Logout revokes the current session. Password reset, email verification/change, MFA, global session management, and automated account recovery are not implemented. Duplicate-registration feedback can reveal that an email is registered; login errors are generic and rate-limited.
- HttpOnly prevents reading the session token through JavaScript; it does not make XSS harmless. A production CSP and broader content/upload/abuse controls need review before public launch. Account and pickup-location data should never be added to listing DTOs.
- Existing listing search and the private plan list remain unpaginated. Plans now enforce server-side ownership; future item/request/conversation authorization must use server-side ownership/participant predicates. Those features are outside this milestone.
- The optional sentiment example still lacks its logger; its test command and the nested importer test command remain course placeholders. The actual importer is covered by backend seed tests.
- No merge, deployment, production index creation, or production database modification is included.

## License and provenance

Derived from the IBM Developer Skills Network capstone, with the existing [Apache 2.0 license](LICENSE) and attribution retained. Verify individual asset licensing before portfolio redistribution.
