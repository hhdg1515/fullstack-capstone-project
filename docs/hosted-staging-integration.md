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

Proposed free alias: **https://moveout-e2e-clarkswift1-9306s-projects.vercel.app**. This is a candidate, not an assertion of allocation, availability or deployment. The workflow accepts an exact approved `.vercel.app` origin and refuses another project's alias or any frontend Production alias. After assignment it stays stable across manual staging deployments, independent of PR URLs. No domain purchase, unrelated DNS or account-wide settings are involved.

## Routing and deployment

The manual **Prepare or deploy isolated staging frontend** workflow defaults to **plan**, requiring no cloud credential and making no remote changes. After approved merge, it builds the unchanged CRA app with empty `REACT_APP_BACKEND_URL` and creates ignored Vercel Build Output v3 containing only compiled assets, the fixed frontend project link and the reviewed `frontend-config.cjs` routes. No active source `giftlink-frontend/vercel.json` is installed onto Production.

Routing order:

1. `/api/*` on the exact approved test Host → dedicated API `/api/*`, no-store.
2. API requests on any other Host → JSON 503 without a staging destination.
3. Static files, then `index.html` for non-API deep links.

Vercel must preserve path/query, browser Origin, Cookie/Set-Cookie and `X-Deployment-Target`. Cookies belong to the frontend host: Secure, HttpOnly, SameSite=Lax, path `/`, no Domain. Existing `credentials: include`, JSON/CSRF requirements and strict backend Origin remain intact. No wildcard CORS or reflected arbitrary Preview origins. Real browser verification must establish provider forwarding behavior.

**deploy** requires an `isolated-e2e` secret **VERCEL_TOKEN** with the owner's approved access to the existing team/projects. Never put it in inputs/chat/source. Pinned CLI 65.2.0 and frontend dependencies install/build without credentials; only the management step receives this token. No database secret is mapped into this workflow. Raw CLI/provider errors are suppressed; sanitized phase receipts are uploaded, including partial failures.

Deployment steps:

1. Require manual `main`, exact reviewed full SHA, distinct free test origin and fixed existing project IDs. Reject the known frontend Production/API origins and custom DNS.
2. Verify frontend root `giftlink-frontend`, backend root `giftlink-backend`, backend Node `22.x` and existing deployments. Refuse a foreign alias or any alias pointing at frontend Production.
3. Deploy prebuilt assets to **Preview only** on the existing frontend project; verify its actual project/target, then assign the exact test alias.
4. Perform GET-only public HTTPS preflight. Provider login/protection redirects or broken JSON/routing fail before API configuration changes. Protection settings are never modified.
5. Upsert only `APP_ORIGIN=<test origin>` on the **dedicated API project's** Production environment and redeploy that existing API deployment with its existing secrets. This provider target is named Production; its database tier remains **staging**. Frontend Production is not deployed or changed.
6. Wait for API readiness **and the canonical API alias to point to the new deployment**, then recheck the frontend proxy/fingerprint/deep links/anonymous auth. Record origin, phase and previous/new deployment IDs. No database document/index writes occur.

These are prepared, locally tested steps; Vercel alias ownership, prebuilt output, protection and live cookies are unverified until an authorized deployment/E2E run succeeds. No paid-plan limitation is silently bypassed.

Provider API shapes were checked against the official [Vercel SDK source](https://github.com/vercel/sdk/tree/49e2e4f3139f3874743d87d3daf5e1c77ca4dbfb/src/funcs) (`projectsCreateProjectEnv`, `aliasesGetAlias`, `aliasesAssignAlias`) and the official [CLI redeploy implementation](https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/redeploy/index.ts). Source inspection and mocks do not replace a real authorized provider run.

## Minimal owner actions for missing permissions

1. Review/merge the focused PR; agents do not merge. If using Actions for management, securely add **VERCEL_TOKEN** to `isolated-e2e`. An owner with existing Vercel access can instead perform the same scoped settings/deployment steps.
2. Actions → **Prepare or deploy isolated staging frontend** → Run workflow: `main`, exact reviewed current SHA, approved free test origin, **plan**. Review its project/host/target output. Separately choose **deploy** when ready; there is no automatic plan-to-deploy transition.
3. After successful deployment, set Environment variable **E2E_APP_ORIGIN** to the exact receipt origin. Current integration cannot update variables (403). Retain **E2E_DB_NAME=moveout_e2e_staging** and the existing **E2E_MONGO_URL** secret. Configure an eligible required reviewer to satisfy the pre-existing HTTPS E2E gate; do not remove that gate. Any configured deployment review still requires eligible approval.
4. If provider protection blocks automation, authorize a supported automation-access design separately. Do not disable protection just to pass tests; no bypass token is invented or logged.

No database credentials need to leave GitHub. If integration permissions change, permitted staging updates should be performed directly rather than delegated back to the owner.

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
