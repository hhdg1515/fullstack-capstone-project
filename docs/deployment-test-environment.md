# Milestone 5.6: deployment audit and isolated verification

## Status and authorization

**Code prepared** is separate from **environment deployed** and **live E2E verified**. This change prepares a Vercel-compatible API, reviewed proxy generator, automatic isolated CI browser tests and opt-in remote verification. It does not provision an API project, Atlas resources, secrets, domains or network rules. No live full-stack verification is claimed.

PR #19 was merged into `main` as `08bd443` before this work began. The user confirmed that no dedicated API project, stable test hostname or isolated Atlas database has been created/approved and authorized safe code preparation/local testing only.

## Observed architecture and permissions

- Vercel's GitHub bot identifies the existing project as `fullstack-capstone-project`, with root `giftlink-frontend`, connected to this repository. Pushes/PRs automatically produce frontend previews. The code is CRA (`npm ci`, `npm run build`, output `build`), React Router and the existing environment-selected API base. Actual dashboard build overrides and Production/Preview secret settings could not be inspected with the available credentials.
- Before this change no repository Vercel routing configuration existed. A frontend-only SPA fallback can serve HTML for `/api/*`; PR #19 now handles this safely. React uses `credentials: include` and an empty production API base for same-origin `/api`.
- Local Express startup (`server.js`) waits for a database, verifies ten required indexes and replica-set/sharded topology, then listens. `app.js` retains its app-factory import contract. The factory now lives in `app-factory.js`; `index.js` exports a concrete Express instance for Vercel's detector. The official detector otherwise prefers an `app.js` that imports Express and would select the factory rather than the hosted application.
- Native-driver connection promises are cached. Accounts use bcrypt; sessions store token hashes with expiry and TTL cleanup. Every authenticated request checks expiry. Writes require an exact APP_ORIGIN, JSON and X-CSRF-Protection. Production cookies are Secure, HttpOnly, SameSite=Lax, path=/, no Domain, named `__Host-giftlink_session`.
- GitHub credentials allow repository changes, PRs, Actions execution/status reads and observation of the existing Vercel integration. GitHub Environment inspection returned no configured environments. Secret/variable-list APIs returned 403. No Vercel/Atlas management tool or VERCEL_TOKEN/MONGO_URL/Atlas credentials was available. Thus project/env/Atlas administration must be authorized and configured by an account owner or a newly approved integration.

## Provider evidence and chosen architecture

Choose **the existing Vercel frontend project + a separate dedicated Vercel Express API test project + an isolated Atlas database**. This preserves the architecture and independently scopes database secrets. No Next.js, replacement auth, container hosting or external search service is needed.

Canonical official references:

- https://vercel.com/docs/frameworks/backend/express
- https://vercel.com/docs/rewrites
- https://vercel.com/docs/projects/environment-variables
- https://vercel.com/docs/deployment-protection

Direct documentation/preview requests from this execution environment were blocked by the CONNECT proxy (403). Instead, current official Vercel GitHub sources were inspected at `vercel/vercel` commit `c628be7835e03a965b93e9cf9e2bd5ac2acbf5eb`:

- [Express example](https://github.com/vercel/vercel/tree/c628be7835e03a965b93e9cf9e2bd5ac2acbf5eb/examples/express) exports an Express application.
- [Framework definition](https://github.com/vercel/vercel/blob/c628be7835e03a965b93e9cf9e2bd5ac2acbf5eb/packages/frameworks/src/frameworks.ts) selects `@vercel/express` and a catch-all route.
- [Express builder](https://github.com/vercel/vercel/blob/c628be7835e03a965b93e9cf9e2bd5ac2acbf5eb/packages/express/src/build.ts) discovers Express-importing app/index/server files and preserves rewritten request paths via a request.path transform.
- [Routing types](https://github.com/vercel/vercel/blob/c628be7835e03a965b93e9cf9e2bd5ac2acbf5eb/packages/routing-utils/src/types.ts) support host conditions, external destinations, filesystem handling and status codes.

These sources support the prepared configuration; they do not replace a real Vercel build/deployment test. Account-plan duration, egress, protection and runtime settings remain to be verified in the approved project.

## API project configuration to approve

Proposed project purpose: dedicated **test API**, not the existing production application. The project name/organization must be chosen/approved by the owner.

| Setting | Required value |
| --- | --- |
| Repository | This repository, reviewed immutable commit |
| Root directory | `giftlink-backend` |
| Framework | Express (`vercel.json`) |
| Node | 22.x (`package.json` engines) |
| Install | `npm ci` |
| Entrypoint | Auto-detected `index.js`; no listening port in hosted mode |
| Build/output | Express framework defaults; do not configure CRA's build directory here |
| Git deployment scopes | Explicitly approved test branch/alias only; no changes to existing Production |

The new API project's Vercel environment label and the application's DB tier are different concepts. Even if using that dedicated project's stable provider alias, its database tier must be **staging**. Do not point it at a production/personal database. Frontend Production and arbitrary Preview domains are not interchangeable origins.

Hosted cold initialization shares one promise/pool (maximum ten connections per warm instance, idle timeout 60s), checks existing indexes/topology, and inspects the actual target. Failures close the failed client, return safe JSON 503 and back off five seconds. There is no index creation, demo import or listener startup. Normal `npm start` retains its existing local behavior. Warm instances reuse pools; this is not a global connection limit across instances.

`GET /api/health` pings the connection and returns only `{ status, environment, databaseFingerprint }` with no-store caching. The one-way fingerprint binds configured endpoints, database, tier and observed replica-set/sharded identity using the same guarded preparation code. It exposes no URI, credentials, database name or user data. It is a confirmation aid, not an authentication credential. Optional X-Deployment-Target mismatches return 409 before any API handler; E2E sends the approved fingerprint on every request and preflight proves that the proxy forwards it. Product auth/CSRF/ownership rules still apply.

## Secrets and environment matrix

| Location/scope | Name | Purpose |
| --- | --- | --- |
| Dedicated API test deployment only | `MONGO_URL` | TLS Atlas connection secret, scoped to approved test database |
| Dedicated API test deployment only | `MONGO_DB_NAME` | Explicit dedicated name, proposed `moveout_e2e_staging` |
| Dedicated API test deployment only | `DB_ENVIRONMENT=staging` | Target identity and operational tier |
| Dedicated API test deployment only | `NODE_ENV=production` | Secure production cookie behavior |
| Dedicated API test deployment only | `APP_ORIGIN` | Exact approved HTTPS **frontend test** origin, no trailing slash/path |
| Dedicated API test deployment only | `SESSION_TTL_SECONDS` | Existing default 28800; valid 300–604800 |
| Frontend approved test build | `REACT_APP_BACKEND_URL` | Empty for same-origin proxy; never MongoDB secrets |
| Protected GitHub Environment `isolated-e2e` secret | `E2E_MONGO_URL` | Scoped verifier/cleanup connection secret for the same test database |
| Protected GitHub Environment variables | `E2E_APP_ORIGIN`, `E2E_DB_NAME` | Exact approved test origin/database |
| Operator workflow inputs | Commit SHA, operation, origin, database, fingerprint, optional run ID | Explicit scoped approvals, not secrets |

Store credentials in Vercel backend/GitHub Environment secret storage, not chat, issues, PRs, source, shell history, artifacts or frontend variables. Application and runner credentials should be database-scoped. Use separate authorized administration credentials for index preparation if needed. Never request/read production credentials for these tests.

## Frontend proxy without production-to-test leakage

Generate an **inactive review artifact**, only after actual API/test-frontend origins are approved:

```bash
mkdir -p deployment/generated
node deployment/frontend-config.cjs https://APPROVED_API_ORIGIN https://APPROVED_FRONTEND_TEST_ORIGIN deployment/generated/test.vercel.json
```

Replace the placeholders with exact HTTPS origins; the generator refuses credentials, paths and overwriting an existing output file. Review before installing as the frontend's `vercel.json` or equivalent approved project configuration. Nothing automatically applies this file.

Routes are ordered:

1. Only the exact approved **test Host**, `/api/*` → approved API origin `/api/*`; preserve path/query and no-store responses.
2. Other unmatched API requests → static JSON 503 (`service-unavailable.json`), never SPA HTML and never the staging API.
3. Existing static files.
4. React Router fallback to `/index.html`.

The host condition prevents a later merge from silently routing existing Production or unrelated Preview domains to the test database. Production API integration requires a separate approved mapping. Keep original Origin, Cookie, Set-Cookie and CSRF headers intact. The browser cookie belongs to the frontend host because it has no Domain; the API's direct hostname is not used as the browser API base. Do not enable wildcard CORS, SameSite=None or arbitrary Preview-origin reflection. A stable approved frontend hostname is needed because the backend accepts exactly one Origin. Reuse an existing suitable alias if approved; otherwise creating/changing an alias/domain needs separate approval.

Deployment protection must permit authorized automation to reach both frontend/API paths without SSO redirects. No protection bypass token is included or requested in logs. If the chosen protected preview needs automation access, approve that provider configuration separately; do not disable security just to pass tests.

## Atlas setup plan: no remote writes performed

1. Owner verifies an Atlas project and transaction-capable cluster dedicated/suitable for test isolation, then approves a **new, unused** test database (`moveout_e2e_staging` proposed). Do not infer safety from an existing connection or name.
2. Approve scoped application/verifier/admin users and a network-access design for Vercel and the Actions runner. Neither this PR nor the workflow changes users, passwords, IP rules or TLS policy. Vercel/hosted Actions egress and any fixed-egress account requirements need provider verification; no automatic `0.0.0.0/0` access or paid network service is selected.
3. Store the approved URI and database/environment securely for the administration command. Verify the Atlas project/cluster in the provider UI and compare the CLI's redacted endpoints/database/topology. Dry-run is read-only:

```bash
npm --prefix giftlink-backend run db:prepare -- --allow-remote --dry-run
```

4. After explicit index-write approval, use the exact printed target fingerprint:

```bash
npm --prefix giftlink-backend run db:prepare -- --allow-remote --apply --confirm-db moveout_e2e_staging --confirm-environment staging --confirm-target APPROVED_64_CHARACTER_FINGERPRINT
```

This creates only the existing ten compatible indexes: normalized unique user email, session TTL, owner/deadline plans, item owner/publication/pickup-start, giver/receiver request lists, one accepted request/item and one active request/receiver/item. Duplicate/non-normalized accounts and incompatible/duplicate reservation indexes block preparation with counts. No records are normalized, deleted, merged or seeded. There is no schema redesign or new collection beyond those already used by the application.

## Repeatable local and CI verification

No user-operated VSCode/Docker/manual two-account test is needed: the normal PR CI now builds the frontend and runs an isolated browser job. To reproduce locally where Node 22, Docker, OpenSSL and Chromium are available:

```bash
npm --prefix giftlink-backend ci
npm --prefix giftlink-frontend ci
npm --prefix e2e ci
CI=true REACT_APP_BACKEND_URL= npm --prefix giftlink-frontend run build
npm --prefix e2e run test:policy
npm --prefix e2e exec -- playwright install chromium
npm --prefix e2e test
```

A preinstalled local Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; CI installs pinned Playwright Chromium. Always finish the production build before running browser tests. The local fixture ignores application MongoDB credentials, starts the existing verified disposable replica-set helper, explicitly prepares indexes, and serves production frontend assets via a loopback HTTPS proxy to the hosted Express entrypoint. The local certificate is self-signed and trusted only by the local test browser; **remote tests never ignore TLS errors**. This validates Secure/HttpOnly cookie behavior but is not Atlas/Vercel/TLS-provider verification.

Each desktop/mobile workflow registers separate synthetic giver/receiver users and tests real bcrypt/database persistence, login/incorrect password, /me, reload, logout revocation, invalid/expired sessions, CSRF/Origin, private ownership, plans/timezone/three published items, anonymous discovery/direct link/login return, pending/accepted requests, duplicate reservation rejection, cancellation, completion/clearance and no-show release. Local completion uses an injected pickup-service clock and the browser's isolated JS clock; there is **no deployed clock endpoint or environment bypass** and no system-clock modification. Remote completion waits for a real near-future appointment. Existing integration tests additionally cover three-party competing acceptance/transaction races.

A separate local-only fault test returns frontend HTML in place of the API and verifies the PR #19 recovery flow. It is explicitly skipped remotely; no deployed backend is mocked or disabled.

## Opt-in real HTTPS E2E

The `Approved isolated HTTPS E2E` workflow is **manual only**, never triggered by PRs/pushes. An existing `isolated-e2e` GitHub Environment with required reviewers must be configured by an authorized owner first. Gate validation checks that environment before referencing it, preventing accidental automatic creation of an unprotected environment. It also requires the exact reviewed 40-character workflow commit SHA. The environment's branch/deployment policies must permit that approved ref. GitHub only exposes a new workflow_dispatch workflow after its file exists on the default branch, so first use requires an explicitly approved merge/installation of the workflow. Thereafter a reviewed branch/ref can be selected by its exact SHA. Before that, the same guarded CLI can run from an explicitly approved runner with securely supplied credentials; no remote run was performed here. Repository-wide concurrency serializes remote runs/cleanup. No remote workflow was dispatched during preparation.

1. Configure the protected Environment and secrets/variables above; review the immutable workflow SHA.
2. Dispatch **preview** first. The runner verifies TLS, Atlas target/topology, prepared indexes, JSON staging readiness, matching database fingerprint, and forwarding of a deliberately wrong target header (must return 409). It reports the fingerprint and synthetic-account count, performing no document/index writes. Missing credentials, protection redirects or inaccessible URLs fail closed.
3. After reviewing that output and approving **up to four synthetic accounts, two plans, six items, eight pickup requests, eight issued sessions and two owned session-expiry updates (one per browser project)**, dispatch **run** with exact origin/database/staging/fingerprint confirmations. Requests carry the deployment-target fence; browser writes to other origins/non-API paths are blocked. Direct API requests do not follow redirects. No production/default database is accepted. Existing synthetic accounts block a new run until cleanup is reviewed.
4. Review local/remote test results separately. Remote runs use real HTTPS/cookies and wait for the actual appointment. Raw call errors, passwords, cookies, hashes, traces, video and screenshots are suppressed; the safe reporter emits checkpoint names/statuses only. Test receipts contain only run ID, target origin/database/fingerprint and the maximum account budget, never credentials. Do not enable raw traces or publish local error-context files.

CLI equivalents, using securely configured environment variables, are `npm --prefix e2e run remote:preview`, `remote:run`, and `remote:cleanup`. The write commands require `E2E_APPROVE_OPERATION`, `E2E_CONFIRM_ORIGIN`, `E2E_CONFIRM_DB`, `E2E_CONFIRM_ENVIRONMENT=staging` and `E2E_CONFIRM_TARGET`. Direct Playwright remote invocation is refused without the guarded launcher. Tests do not create indexes or seed gifts.

## Test-data lifecycle and rollback

Emails are `e2e+<32-hex-run>.<desktop|mobile>.<giver|receiver>@example.test`, first name E2E, last name the run ID. Plan/item labels carry the same run prefix. The run receipt is written before registration. Retries are disabled; leftover synthetic accounts stop the next run, preventing unlimited registration. Failed runs keep their bounded fixtures for review; there is **no automatic remote deletion**.

For cleanup, set the exact `E2E_RUN_ID` and dispatch **preview** to see owned counts. Then obtain separate **cleanup** approval with the same target confirmations/run ID. Cleanup checks user identity/labels/ownership and record caps, refuses outsider-linked requests or unexpected data, and deletes explicit IDs in one transaction. It never calls broad `deleteMany({})`, drops a collection/database, or touches gifts. Local policy tests prove unrelated accounts/plans and all 16 bundled gifts survive, and repeated cleanup is safe.

Rollback order: stop remote jobs; preview/review scoped cleanup while the verified test API is still available; approve cleanup if desired; restore the prior frontend deployment/routing and prior API code/config through approved provider controls. Retain compatible indexes, do not drop the database or revert production data. The existing frontend can remain frontend-only with PR #19's graceful unavailable state. If the verified API is no longer available, cleanup refuses; restore the approved test service or arrange a separately reviewed scoped administration operation.

## Remaining approval checklist

- Approve the dedicated API project/org and its root/runtime/environment settings.
- Approve the exact stable frontend test origin/API origin and test-only proxy configuration; preserve existing Production.
- Approve the Atlas project/cluster/new test database, scoped users and network access; store secrets securely.
- Review the database dry-run, then explicitly approve only the required index creation.
- Configure the reviewer-protected GitHub Environment and authorize a read-only preflight, then the bounded run and eventual scoped cleanup.
- Verify actual Vercel deployment health, proxy, protection, HTTPS cookies and E2E results. Until then the correct state is **code prepared; environment not provisioned; live E2E not verified**.

Basic rate limits remain per warm process rather than globally distributed, and proxy/client-IP behavior has not been certified on a live deployment. Origin/CSRF/session/ownership protections are retained. Before public launch, review provider abuse controls, aggregate registration limits, Atlas connection budgets, observability and network policy; no CAPTCHA, paid moderation, or new product feature is introduced here.
