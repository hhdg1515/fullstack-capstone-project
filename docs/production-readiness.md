# Milestone 6.0: readiness audit and controlled launch

Status: **keep Deployment Protection enabled; public launch is not approved**. This milestone prepares operations and tests, not a production deployment or new marketplace feature.

## Evidence boundary

- Audit baseline: merged main `6d61d16041ba3c8792174b09352bac6a31b292d3` (PR #26).
- Live staging: GitHub records a successful staging deploy [40170045941](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40170045941), successful owner-authorized HTTPS E2E runs on baseline main, and a synthetic run receipt for [40171965754](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40171965754). Later successful workflow records include [40173581994](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40173581994) and [40175463291](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40175463291). Owner reports successful scoped cleanup. Metadata/receipt existence is independently observed; raw logs, operation inputs and post-cleanup record counts are not independently re-read here. No new remote E2E writes are performed by this audit.
- Atlas configuration verified by the owner through the connected Atlas integration: Project 0 / Cluster0, FREE M0, MongoDB 8.0.34, IDLE/not paused, database `moveout_e2e_staging`; runtime user `moveout_staging_app` has `readWrite` only on that database. Access list contains two entries: `0.0.0.0/0` labelled temporary Vercel staging testing, plus one individual IP. Actual rule expiration is unverified. No dedicated backup or tested restore is confirmed. These are owner-verified control-plane findings, not this agent's independent Atlas API inspection.
- GitHub: `isolated-e2e` exists with no protection rules/deployment-branch policy; the workflow's explicit owner/main/exact-SHA gates remain the authorization mechanism. Repository rulesets list is empty. Branch protection and Actions permission endpoints return 403, so their settings cannot be certified. Existing secrets stay in GitHub; no credentials are copied into the cloud workspace.
- Current tools expose no Atlas/Vercel management connector or cloud credential. The existing manual GET-only Vercel inspect workflow can use its stored token in Actions. The audit adds a fixed metadata projection: unknown/masked fields remain unknown; secret values and provider response bodies are never returned. Atlas access lists, backup settings and privileges cannot be inferred from a healthy data-plane request.

## Launch blockers

| Finding | Evidence and consequence | Required disposition |
| --- | --- | --- |
| Production mapping and database are not authorized or verified | One known backend project is deliberately staging; the frontend project also serves Production. A Ready badge or successful staging E2E does not approve production destinations. | Owner approves a separate production inventory, secret scope, DB fingerprint, origin/protection and routing plan. Do not create a DB or change routes in this milestone. |
| Durable Atlas access is unresolved | The owner verified a broad temporary rule still exists; expiration is unknown. Standard Vercel/GitHub-hosted egress is not a single stable IP. | Choose an explicit staging/public-launch egress policy, review rule expiration and remove/replace temporary broad access only with owner approval. Never auto-renew or add provider-wide IP ranges. |
| Recovery is unproven | M0 is not evidence of managed backups; no backup/restore arrangement or recovery drill is confirmed. | Establish encrypted DB-scoped exports and rehearse an isolated restore, or separately approve another supported backup arrangement. No recovery objective is promised until measured. |
| Public abuse/client-IP controls are not established | Auth/discovery/pickup limits are in-memory per warm instance; Express does not trust proxy headers. A provider proxy can collapse users into one bucket, while scaling defeats a global limit. | Validate authoritative client-IP behavior and approve enforceable edge/global caps before opening registration. Do not set `trust proxy=true` blindly or add paid services automatically. |
| Frontend dependency risk needs runtime/build separation | Baseline `npm audit`: backend production dependencies 0 findings; frontend dependency tree 387 (112 low, 168 moderate, 96 high, 11 critical). The browser runtime router is included; many other findings are build/dev tooling. | Patch compatible runtime dependencies with tests; evaluate remaining CRA/build advisories and CI credential exposure. Do not treat all findings as deployed server vulnerabilities or run force upgrades/migrate stacks. |

## Important operational improvements

| Finding | Existing protection / gap | Milestone treatment |
| --- | --- | --- |
| Cold-start diagnostics are too generic | Startup checks DB, indexes and replica set before serving, shares initialization and retries after backoff. `hosted_startup_failed` hides the failed phase. | Add allowlisted phase/category diagnostics; never log driver text, URIs, headers, bodies, email, tokens or pickup notes. |
| Hosted connection waits use driver defaults | Warm pool is capped at 10 with zero minimum and idle cleanup, but connection/pool wait deadlines are not explicit. | Bound selection/connect/queue waits; retain native driver recovery and avoid multiplying clients per request. |
| Liveness and DB readiness are conflated | `/api/health` checks the approved target and DB; it must keep its existing JSON/fingerprint contract. | Add a cheap explicit liveness signal and correlation IDs without relaxing the fingerprint fence or returning configuration. |
| Legacy search accepts structured/raw regex input | Demo browse/search is public and unpaginated. Main discovery already bounds query length, page size, execution time and escaped text. | Bound legacy query types/length and regex work while preserving normal gift browsing and all 16 demo records. Document compatibility limits. |
| Frontend fetches can remain pending indefinitely | Service-unavailable and expired-session states already exist; writes are never automatically retried. | Add a bounded client wait with an outcome-uncertain message and regression tests. |
| Accessibility/manual mobile coverage is incomplete | Existing labels, skip link, focus styles, menu Escape, mobile sizing and desktop/mobile real-user workflows help. They are not screen-reader certification. | Add automated checks of key public/account pages and record manual keyboard/screen-reader/date-picker/zoom gaps. No redesign. |
| Operational response ownership is undocumented | Safe request logging exists; no established alerting thresholds, maintenance cadence or restore evidence. | Provide operator checklists, health interpretation, staged verification and rollback/incident decisions. |

## Optional later enhancements

- Distributed rate limiting, paid static egress/private networking or managed backup/PITR, only after a usage/cost decision.
- Account recovery/email verification and abuse/reporting workflows require a separate product/security scope; no messaging, payments, shipping, images or map integration is added here.
- Richer load/performance testing, stronger browser/platform accessibility coverage, dashboards and automated encrypted backup scheduling once ownership/storage/retention are approved.

## Atlas access and recovery decisions

Configuration findings above are separate from recommendations. The current DB-scoped `readWrite` role is a useful boundary; it is not a production credential and no production DB is assumed. App startup verifies indexes rather than creating them. Any finer custom role, separate backup/admin user, credential rotation or tier change requires owner approval and a verified target.

Do not infer a stable IP from one function invocation or one runner. Low-cost options are a short, explicitly approved staging test window with reviewed expiration, or an already available owner-operated fixed-egress host/runner. Neither solves Vercel's own dynamic egress automatically. Provider static egress/private endpoints may require paid plans/tiers and are proposals only. A durable launch policy must cover both API runtime and verification/backup clients while keeping production separate.

For recovery, prefer an owner-controlled encrypted volume and DB-scoped `mongodump` archive, checksum and manifest; never publish private DB backups as unencrypted Actions artifacts or in the repository. Use Database Tools' private config-file support to avoid credentials in argv/history. M0 logical exports are not point-in-time backups: arrange a no-writes window and verify cross-collection consistency. Restore only into an explicitly approved empty isolated target, with namespace remapping and no automatic `--drop`, then verify data/ownership/indexes and revoke restored sessions before any eventual service cutover. Full procedure and provider references will accompany the operational implementation. No export, restore or backup configuration is executed by this audit.
