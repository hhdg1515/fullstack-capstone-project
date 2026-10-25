# Hosted staging integration (Milestone 5.7)

Code preparation, deployed infrastructure and live HTTPS verification are separate states. Local tests and a Vercel Ready badge do not establish live E2E success.

## Evidence and access

- Baseline: merged `main` `b1e0280b6952fe153eefe3873298408bdba6f189`, including PR #21. GitHub confirms successful preparation runs [40126281537](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40126281537) and [40126461899](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40126461899).
- Fresh agent-dispatched read-only database dry-run [40128321995](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40128321995) completed successfully using the existing Actions secret/variable. This verifies current runner connectivity and the guarded command's success. Its detailed log/printed fingerprint was not independently retrieved here; do not equate its exit status with a fresh comparison of every printed index operation or topology value. No apply was dispatched.
- Owner-verified API: `https://fullstack-capstone-project-vkwm.vercel.app`, Node 22, staging Atlas **Project 0 / Cluster0 / moveout_e2e_staging**, all ten indexes. Approved fingerprint: `8ea1ee6b3396707c1c838e0ae254401c0c58c980993cb6988c0071c7def91acf`.
- Frontend Production: **https://fullstack-capstone-project-flax.vercel.app**. Staging automation must never proxy/reassign/deploy this hostname.
- Vercel's existing GitHub bot identifies both project IDs and their team ID. `deployment/staging-target.cjs` pins them. Management checks actual names, root directories, backend Node version and deployment targets before mutations; no project is created.
- `isolated-e2e` exists, with no required reviewers currently configured. The existing HTTPS E2E gate requires a reviewer. The token can read environment metadata and manage code/PRs/Actions, but secret/variable APIs return 403. Database credentials remain in Actions as configured by the owner.
- No Vercel/Atlas management connector or token is available here. Runtime inspection reports no configured cloud secrets/identities. Direct Vercel access is denied by this environment's proxy. Use Actions; do not bypass the proxy or copy database credentials into Codex Cloud.

Existing assigned test alias: **https://moveout-e2e-clarkswift1-9306s-projects.vercel.app**. It is pinned in `deployment/staging-target.cjs`; deployment, diagnostics and remote automation refuse a different origin. It stays stable across manual staging deployments, independent of PR URLs. No domain purchase, unrelated DNS or account-wide settings are involved.

## Routing and deployment

The manual **Prepare or deploy isolated staging frontend** workflow defaults to **plan**, requiring no cloud credential and making no remote changes. After approved merge, it builds the unchanged CRA app with empty `REACT_APP_BACKEND_URL` and creates ignored Vercel Build Output v3 containing only compiled assets, the fixed frontend project link and the reviewed `frontend-config.cjs` routes. No active source `giftlink-frontend/vercel.json` is installed onto Production.

The CLI executes from the repository root so its existing `rootDirectory=giftlink-frontend` remains valid. Identical ignored output/project links are prepared at both repository and frontend roots for the CLI's supported monorepo link modes; only compiled assets are copied. Provider root-directory settings remain unchanged.

Routing order:

1. `/api/*` on the exact approved test Host → dedicated API `/api/*`, no-store.
2. API requests on any other Host → JSON 503 without a staging destination.
3. Static files, then `index.html` for non-API deep links.

Vercel must preserve path/query, browser Origin, Cookie/Set-Cookie and `X-Deployment-Target`. Cookies belong to the frontend host: Secure, HttpOnly, SameSite=Lax, path `/`, no Domain. Existing `credentials: include`, JSON/CSRF requirements and strict backend Origin remain intact. No wildcard CORS or reflected arbitrary Preview origins. Real browser verification must establish provider forwarding behavior.

**deploy** requires `isolated-e2e` secrets **VERCEL_TOKEN** (approved existing team/projects) and **VERCEL_AUTOMATION_BYPASS_SECRET** (owner-created frontend automation access). Never put them in inputs/chat/source. Pinned CLI 65.2.0 and frontend dependencies install/build without credentials; the bypass secret is also removed from the CLI subprocess environment. No database secret is mapped into this workflow. Raw CLI/provider errors are suppressed; sanitized phase receipts are uploaded, including partial failures.

Deployment steps:

1. Require manual `main`, exact reviewed full SHA, distinct free test origin and fixed existing project IDs. Reject the known frontend Production/API origins and custom DNS.
2. Verify frontend root `giftlink-frontend`, backend root `giftlink-backend`, backend Node `22.x` and existing deployments. Refuse a foreign alias or any alias pointing at frontend Production.
3. Deploy prebuilt assets to **Preview only** on the existing frontend project; verify its actual project/target, then assign the exact test alias.
4. Perform GET-only public HTTPS preflight. Provider login/protection redirects or broken JSON/routing fail before API configuration changes. Protection settings are never modified.
5. Upsert only `APP_ORIGIN=<test origin>` on the **dedicated API project's** Production environment and redeploy that existing API deployment with its existing secrets. This provider target is named Production; its database tier remains **staging**. Frontend Production is not deployed or changed.
6. Wait for API readiness **and the canonical API alias to point to the new deployment**, then recheck the frontend proxy/fingerprint/deep links/anonymous auth. Record origin, phase and previous/new deployment IDs. No database document/index writes occur.

These are prepared, locally tested steps; Vercel alias ownership, prebuilt output, protection and live cookies are unverified until an authorized deployment/E2E run succeeds. No paid-plan limitation is silently bypassed.

Provider API shapes were checked against the official [Vercel SDK source](https://github.com/vercel/sdk/tree/49e2e4f3139f3874743d87d3daf5e1c77ca4dbfb/src/funcs) (`projectsCreateProjectEnv`, `aliasesGetAlias`, `aliasesAssignAlias`) and the official [CLI redeploy implementation](https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/redeploy/index.ts). Source inspection and mocks do not replace a real authorized provider run.

## Read-only Vercel validation diagnostics

If `validate_projects` fails, do not retry **deploy** to diagnose access. Select **inspect** in the same workflow, with the approved test origin and exact reviewed commit SHA. Inspection also supports a diagnostic feature branch before merge; **plan** and **deploy** remain manual `main` operations. Inspect skips dependency installation, React build and the CLI entirely. Only its Node management step receives `isolated-e2e.VERCEL_TOKEN`; no MongoDB secret is mapped.

Inspect sends GET requests only, always scoped to the fixed approved team. It independently checks both pinned projects by ID and name, their returned team ownership/configuration, the intended team, the two existing canonical aliases and the deployments bound to those aliases. It also reproduces the original direct deployment-hostname queries to identify the first legacy validation failure. It never creates a deployment, assigns an alias, updates environment variables or changes protection settings. A transport-level read-only guard rejects every non-GET method.

Each request emits only a fixed operation name, resource category, endpoint template, HTTP status and result/classification. Failed requests appear as Actions warning annotations and the complete summary as one notice, within Actions' per-step annotation limits, so diagnosis does not require downloading raw logs. No token, connection string, account metadata, response body or environment-variable values are printed. A 404 is explicitly **not_found_or_inaccessible**: Vercel can hide unavailable resources, so a 404 alone does not prove a stale ID or wrong token scope. HTTP 401, 403, malformed JSON and transport errors have separate classifications. The inspection summary separately reports access, team ownership, configuration and name/ID matches as booleans, plus the first failing legacy operation. Deployment additionally verifies both projects' returned `accountId` before any mutation.

The official pinned SDK defines `GET /v9/projects/{idOrName}`, `GET /v13/deployments/{idOrUrl}`, `GET /v4/aliases/{idOrAlias}` and `GET /v2/teams/{teamId}`. Deployment `idOrUrl` describes a deployment's ID or its unique `url` hostname; a stable project alias is a separate resource. Compare direct-hostname results with explicit alias-to-deployment-ID resolution before changing API versions or IDs.

Interpretation and minimal owner actions:

- Both project checks succeed with the intended `accountId`: token read access to both approved projects in the fixed team is confirmed. This does not prove write permission or deployment readiness.
- ID lookup fails while name lookup returns a different ID: verify the project's **Settings → General → Project ID** in the intended team and review a pin correction; never select a replacement project automatically.
- ID lookup fails while the same named project's ID matches: investigate provider resource visibility/permissions; do not infer an ID change.
- Project/team reads return 401, 403 or unexplained 404: in Vercel **Account Settings → Tokens**, verify that the stored token is unexpired and scoped to the team containing both approved existing projects. If necessary, create a replacement token for that team using an account already authorized for both projects, then replace only GitHub **Settings → Environments → isolated-e2e → VERCEL_TOKEN**. If the token type offers per-project grants, include these two projects only. Do not grant unrelated teams, account administration or Atlas access; never paste the token into a workflow input, PR or chat. Rerun **inspect** before considering deployment.
- Project and alias/ID reads succeed but a direct alias-hostname deployment query returns 404: fix alias resolution; increasing token scope is not supported by that evidence.

Do not automatically disable protection, change a production frontend route, retry deployment or broaden token privileges in response to a 404.

### Investigation of the initial `validate_projects` failure

Read-only Actions run [40163988334](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40163988334) reproduced the first failing original request as **`GET /v9/projects/prj_jzlWNa71F4DWjqsma4JbxPLsUM4c?teamId=team_Czf2GmSPOjNPQh8cBrmyBBX3` → HTTP 404**. The preceding frontend project lookup returned 200. Frontend name lookup and canonical deployment/alias reads also returned 200; backend name and alias reads returned 404, while backend deployment and team metadata reads returned 403. Thus the frontend's direct alias-hostname deployment lookup works with this token; an alias-resolution or API-version change is not justified by this failure.

The [Vercel bot's current project links](https://github.com/hhdg1515/fullstack-capstone-project/pull/23#issuecomment-6393697197) contain the same two project IDs and team ID as the repository pins. No identifier was automatically replaced. A 404 on both backend ID/name plus 403 on its deployment supports an authorization/visibility blocker, but cannot conclusively distinguish hidden resources from a moved/deleted project. An owner should verify the backend still belongs to the approved team and ensure the existing secret's token has access to **both** projects. Frontend access does not prove backend access. No deployment was retried during diagnosis.

Complete-summary confirmation run [40164183497](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40164183497) reports frontend access, team ownership, configuration, name/ID match and alias resolution all true; backend access remains false. Ownership/configuration booleans are also false for an unreadable project, so they are not evidence of a wrong stored configuration when access itself failed. Inspect exits nonzero for missing access or required validation; this run's failure correctly records the remaining provider access blocker. A forbidden team metadata read alone does not disprove team ownership: the frontend's returned `accountId` was verified against the pinned team.

## Diagnose `verify_public_preview` without redeploying

Use **Prepare or deploy isolated staging frontend → diagnose-https**, the exact reviewed commit SHA, the existing assigned test origin, and optionally the original failed Actions run ID. Read-only diagnostic branches are supported; plan/deploy remain `main` only. This operation skips builds, CLI and management operations. Its HTTPS process receives only the approved automation bypass secret, sends application-anonymous GETs, validates TLS and never follows redirects. No management/database token is mapped to this step. `E2E_APP_ORIGIN` is not required.

The workflow can download the original `staging-deployment-receipt` using GitHub's read-only artifact permission. It validates its origin/API/fingerprint and saves only known phase/deployment-ID fields with the new `staging-https-diagnostics` artifact. The original artifact and assigned alias remain untouched. A receipt at `verify_public_preview` records an assigned frontend preview and confirms that this run had not reached the APP_ORIGIN update/backend redeploy steps; it is historical state, not an audit of subsequent owner actions. Missing/invalid receipts do not prevent HTTPS diagnosis, but produce a nonzero final result.

Both phases check homepage/deep-link built React HTML, wrong-fingerprint JSON 409, approved-fingerprint ready/staging JSON 200 and anonymous JSON 401. All API responses must have `no-store`; an edge-cache HIT is rejected. Every request is diagnosed independently. Only check names, status/error categories and normalized content-type/cache-control categories are printed. Raw HTML/JSON bodies, Location values, cookies, authentication headers and TLS/network error strings never appear in output. A single sanitized Actions notice preserves the complete result within annotation limits. HTTPS failures also retain their precise assertion and results in the normal deployment receipt.

None of the original five anonymous GET assertions requires an updated APP_ORIGIN: `protectWrites` exempts GET/HEAD/OPTIONS, hosted health checks the target before app routing, and anonymous `/api/me` requires no session. These checks remain mandatory **before** changing backend configuration. The **after_origin** phase additionally sends `Origin: <test origin>` on the anonymous GET and verifies exact `Access-Control-Allow-Origin` plus credential allowance; an old backend origin fails only this later assertion. Both phases are read-only. Actual Origin/CSRF write rejection, login and secure-cookie behavior still require the separately approved browser E2E run; header agreement is not a replacement.

If every request still redirects to provider authentication with the owner-created secret, inspect its Environment placement, frontend project scope and rotation/expiration privately. Do not disable protection, broaden the secret's targets, change production routing or retry deploy as a diagnostic action. If JSON routing/readiness fails, use the named assertion and normalized headers to investigate the proxy or backend without skipping the fence/auth/cache requirements.

### Observed protection failure

Owner-run deployment [40166250281](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40166250281) passed both project/deployment validations, created the frontend Preview and assigned the test alias, then stopped at `verify_public_preview`. The earlier backend resource-visibility issue is not the current blocker.

GET-only diagnostic [40166846990](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40166846990) independently checked homepage, `/app/items`, wrong-fingerprint health, approved-fingerprint health and anonymous `/api/me`. **Every request returned 302 / `deployment_protection_redirect`**, with content-type category `other` and cache-control category `no_store`. The same result occurred with the post-change Origin probe. TLS validation produced HTTP responses without TLS errors; application/proxy JSON behavior and configured APP_ORIGIN remain unverified because provider authentication intercepts the requests. No redirect target/body or cookie was printed or followed. The workflow's nonzero exit records this external blocker.

The original receipt was downloaded successfully using read-only Actions access. Its validated phase and previous/new deployment IDs were preserved in the `staging-https-diagnostics` artifact. The source phase records `frontend_alias_assigned_backend_origin_update_not_reached`: no APP_ORIGIN update or API redeployment had been reached in that failed run. Diagnostics did not assign an alias or invoke deployment. Keep that binding and source receipt when deciding how to grant supported staging automation access; do not repeat a deployment to investigate protection.

## Minimal owner actions for missing permissions

1. Review/merge the focused PR; agents do not merge. If using Actions for management, securely add **VERCEL_TOKEN** to `isolated-e2e`. An owner with existing Vercel access can instead perform the same scoped settings/deployment steps.
2. Actions → **Prepare or deploy isolated staging frontend** → Run workflow: `main`, exact reviewed current SHA, approved free test origin, **plan**. Review its project/host/target output. Separately choose **deploy** when ready; there is no automatic plan-to-deploy transition.
3. After successful deployment, set Environment variable **E2E_APP_ORIGIN** to the exact receipt origin. Current integration cannot update variables (403). Retain **E2E_DB_NAME=moveout_e2e_staging** and the existing **E2E_MONGO_URL** secret. Configure an eligible required reviewer to satisfy the pre-existing HTTPS E2E gate; do not remove that gate. Any configured deployment review still requires eligible approval.
4. The owner has now created the frontend automation bypass and stored it as `VERCEL_AUTOMATION_BYPASS_SECRET`; the code consumes it only for the pinned staging origin. Do not disable protection or send the value to chat/logs.

No database credentials need to leave GitHub. If integration permissions change, permitted staging updates should be performed directly rather than delegated back to the owner.

## Approved Protection Bypass for Automation

The owner-created frontend secret stays in `isolated-e2e`. HTTPS preflight uses `x-vercel-protection-bypass` only on the five known GET paths of the pinned test alias. It refuses production, the direct API, arbitrary origins/paths, query strings, writes and extra authentication/cookie headers before sending a credential. Every request uses manual redirect handling; it never follows a redirect with the header. Existing wrong-fingerprint 409, ready/staging JSON 200, no-store, anonymous JSON 401 and post-update exact-Origin assertions remain enforced.

Browser bootstrap follows Vercel's documented headers: `x-vercel-protection-bypass` and `x-vercel-set-bypass-cookie: true`. Each giver/receiver context uses a short-lived separate API context to GET the clean homepage URL with zero redirects and normal TLS verification. It imports only the service-issued `_vercel_jwt`, retaining its expiration and restricting it to a Secure HttpOnly SameSite=Lax cookie on the exact staging host. Broad/foreign domains, wrong paths, insecure/expired cookies and missing cookies are rejected. A subsequent cookie-only GET must return built React HTML. The temporary API context is disposed, no storage-state file is written, and the bypass secret is never a browser-global header, URL or page value. Browser contexts are closed after tests; application login/logout/expired-session/ownership/CSRF behavior is independently checked. The provider cookie grants no application user identity or extra E2E database budget.

Both workflows map the secret only to the relevant execution step, after dependency installation/build. It is never a CRA/frontend variable, Vercel application environment update, CLI argument/environment value, receipt, screenshot, trace, video or log value. Raw Playwright request errors are replaced with fixed categories; DEBUG/PWDEBUG and Node HTTP debug logging are refused in remote automation. Normal PR CI has no real bypass/database secrets. It uses mocked provider transports plus intercepted Chromium requests to test host scoping, HttpOnly behavior and ordinary credential-free requests without contacting Vercel.

Safe diagnostics distinguish `bypass_secret_missing`, `bypass_secret_invalid_format`, `automation_bypass_rejected`, `bypass_cookie_bootstrap_rejected`, `bypass_cookie_missing_or_unsafe`, `bypass_cookie_rejected` and `bypass_cookie_transport_failed`. Missing credentials fail before database connectivity/deployment mutations; HTTPS diagnosis still saves a safe credential failure and any validated source receipt. Rejection does not conclusively prove a bad secret: verify the frontend project/rotation, and whether only the API proxy is independently protected. Never reuse the frontend secret directly on the backend or widen allowed origins to make a test pass.

References: Vercel's [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation#playwright), official [header example](https://github.com/vercel/vercel-plugin/blob/3c88cfc8de5d1e124d23b0ef23f32c5aa127c845/skills/deployments-cicd/references/deployment-checks.md), and [_vercel_jwt cookie guidance](https://github.com/vercel-labs/agent-browser/blob/372ac5ce20fab885dbf45ee0c9d510ec8c3b6fdb/skill-data/protected-vercel-deployments/SKILL.md#static-secret-fallback).

### Execution after review and merge

No deployment, protected hosted probe or remote E2E is automatically dispatched by this change. After the owner reviews/merges the PR:

1. Select the exact current reviewed `main` SHA. Run **diagnose-https** for the existing alias and optionally the prior failed run ID. All **before_origin** checks must pass with provider automation access. If only `after_origin.anonymous_me` reports `app_origin_mismatch`, that is the expected pending backend change, not permission to skip the earlier checks. The diagnostic evaluates both assertion sets against current configuration; it does not update APP_ORIGIN.
2. Run **plan**, then the authorized manual **deploy**, on that same reviewed main SHA and alias. Inspect the preserved source/previous binding before proceeding. The guarded workflow validates both existing projects, creates only frontend Preview, assigns the same test alias, requires the before-origin checks, upserts only dedicated API `APP_ORIGIN` and redeploys that existing API. It then verifies active API alias/readiness and the after-origin checks. Keep the partial receipt if any step fails; no blind retry or automatic rollback. Frontend Production routing and Deployment Protection remain unchanged.
3. Verify `isolated-e2e` variable `E2E_APP_ORIGIN` equals the pinned alias, `E2E_DB_NAME=moveout_e2e_staging`, and the existing MongoDB secret/fingerprint remain the approved target. Retain the required-reviewer Environment gate; configure an eligible reviewer if still missing. Run **Approved isolated HTTPS E2E → preview**. This reads the actual MongoDB target/topology/indexes and HTTPS contract before any synthetic write; no index preparation, Atlas user or network-rule changes are included.
4. Run the authorized **run** operation with exact origin/database/staging/fingerprint confirmations. Respect the fixed limits: four accounts, two plans, six items, eight requests/eight issued app sessions and two owned expiry updates. The two browser contexts get separate provider cookies. Provider cookie bootstrap is GET-only and creates no application account/session. Real browser cookie/login/CSRF/ownership behavior must pass before claiming hosted E2E success.
5. Preserve the owned run ID, preview its cleanup, then execute the separately scoped **cleanup** using that exact ID and target confirmations. Only owned synthetic records are eligible; preserve unrelated records, setup markers and all 16 demo gifts. Report actual Actions outcomes and any unresolved provider/proxy behavior. Never broaden deletion, disable protection or alter Atlas to recover a failed test.

The stored real bypass secret and provider cookie signature/behavior remain unverified until this authorized post-merge sequence runs. Local/CI success verifies implementation and isolation, not the live credential or hosted deployment.

## Real HTTPS preflight and bounded E2E

Run existing **Approved isolated HTTPS E2E**, operation **preview**, first, using the exact selected reviewed commit SHA. It pins `E2E_EXPECTED_TARGET` to the approved fingerprint, inspects the real TLS MongoDB target/topology/indexes and refuses a changed target. Frontend Production and direct API origins are forbidden E2E destinations.

Preview uses only GETs with validated TLS and redirects forbidden: wrong target → uncached JSON 409 `DEPLOYMENT_CHANGED`; correct target → uncached JSON 200 ready/staging with the approved fingerprint; anonymous `/api/me` → uncached JSON 401; `/` and `/app/items` → built React HTML. It prints safe check metadata/counts, never registers users or creates indexes. Cookie/Origin/CSRF behavior is established by the subsequent browser run, not GETs alone.

After successful preflight, the user authorizes the existing bounded synthetic **run** and cleanup of its records. Supply the exact test origin, database, staging tier and approved fingerprint; respect Environment reviews. Desktop/mobile Chromium have separate cookie jars, real TLS and no remote TLS-ignore setting. Report a pass only after the actual Actions run completes successfully.

Budgets stay four accounts, two plans, six items, eight requests/eight sessions and two owned expiry updates. Existing public `limit=1` exercises **Load more** with the same three records per browser project; city/neighborhood/availability filters, publication/deadline sort, search and reload persistence add no records. Auth/bcrypt/session/CSRF, plans/inventory, anonymous links, ownership, acceptance/conflicts/cancellation/completion/no-show and clearance remain covered. Remote tests wait for real appointments; only isolated local constructors/browser contexts use controlled clocks.

Before registration, the synthetic run ID is saved as a nonsecret Actions output. Its receipt artifact name includes that ID, so the agent can find it through artifact metadata even if log downloads are inaccessible. Failed browser runs retain receipts; failure before receipt creation has not started registration. No raw traces/screenshots/video/passwords/cookies/URIs are published.

Preview the exact run's cleanup using **preview** and `cleanup_run_id`, then dispatch the authorized **cleanup** with the same target confirmations and ID. Existing ownership checks, caps, transaction and explicit-ID deletions remain. Never clear collections or touch `setup_marker`, unrelated records or the 16 legacy gifts. No automatic broad deletion fallback.

## Atlas connectivity and maintenance

The owner reported a temporary one-day `0.0.0.0/0` rule. Its actual expiration/current contents cannot be audited without Atlas control-plane access. Data-plane connectivity or healthy API does not prove network-rule configuration. No rule/user/permission changes are included.

Standard Vercel serverless and GitHub-hosted runner egress are not a single guaranteed static IP. Do not trust one observed IP permanently or allow all Azure/GitHub ranges. Practical staging choices:

- Short owner-approved test windows with an expiring temporary rule, test-only scoped credentials, TLS and bounded data. Review/remove access after testing. This is still broad access, never an automatically extended permanent rule.
- An existing owner-operated runner with known fixed egress restricts the verifier connection; the Vercel API still needs its own suitable network access.
- Evaluate provider static-egress/private-network options for durable staging; verify availability/cost and obtain approval before paid upgrades/new infrastructure. No hosting migration is proposed.

Actions use immutable official commits of checkout 7.0.1, setup-node 7.1.0, upload-artifact 7.0.2 and download-artifact 8.0.2 (Node 24 action runtimes). Application/build/test Node remains **22**. Normal CI validates the maintenance upgrade; it does not replace live verification.

## Rollback

Stop remote jobs. Use the sanitized receipt to restore the prior staging alias binding, dedicated API deployment and previously approved API `APP_ORIGIN` through authorized Vercel management. Inspect partial phases before retrying: env updates and multiple deployments are not atomic. Never repoint/redeploy frontend Production, disable protection or alter Atlas/indexes/data as rollback. E2E cleanup remains limited to the authorized synthetic run.
