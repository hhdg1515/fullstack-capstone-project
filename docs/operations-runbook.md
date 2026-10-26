# Controlled launch and recovery runbook

Status: protected staging only. Production launch, production database creation,
provider security changes and paid resources require separate owner approval.
See the [readiness audit](production-readiness.md) for observed facts and unknowns.
None of the procedures below was executed against Atlas by this milestone.

For Phase 6.2 communication, also follow the [message-index readiness, retention
decisions and approval sequence](milestone-6.2-security-readiness.md#future-hosted-sequence--none-executed-here).
The Phase 1 message index remains a rollout prerequisite. Existing remote E2E and
cleanup do not verify or purge messages; expanding their budgets needs separate
review. No remote procedure is authorized by the local Phase 4 results.

## Resource boundaries and release evidence

Keep a private release record containing the reviewed Git commit, CI run,
frontend/API deployment IDs, configured origin, environment, database name and
fingerprint, previous deployment IDs, and approval. Store secret **names**, never
their values. A Vercel deployment with `target=production` in the **dedicated API
test project** is still application **staging**; Vercel target and
`DB_ENVIRONMENT` are different concepts.

| Resource | Permitted staging use | Production rule |
| --- | --- | --- |
| Existing frontend project | Existing `moveout-e2e-clarkswift1-9306s-projects.vercel.app` Preview alias, host-scoped proxy | Do not move/change the existing Production alias or route it to staging |
| Dedicated API test project | `fullstack-capstone-project-vkwm`, Node 22, staging origin/database | Not an approved production API |
| Atlas Project 0 / Cluster0 | Only approved `moveout_e2e_staging`, fingerprint pinned in `deployment/staging-target.cjs` | No production database is assumed or inspected |
| GitHub `isolated-e2e` | Existing manually dispatched, target-confirmed workflows | Do not reuse staging credentials/data for launch |

The HTTPS E2E workflow still requires the repository owner, trusted actor IDs,
manual `main`, exact reviewed SHA and operation-specific confirmations. The
environment currently has no Required Reviewer or branch policy; these explicit
code gates are essential. Future collaborators with write access can change
workflow code, and repository administrators can change gates/secrets. Owner-only
checks are not an independent approval boundary against an administrator or
compromised owner account. Review branch/ruleset settings and account security;
this milestone does not change them.

## Staging release checklist

1. Review and merge code only after normal CI is green. Record the immutable
   merged `main` SHA and previous frontend/API deployment IDs. Git-linked PR
   previews, if the provider creates them, do not count as the approved release.
2. Use the existing staging workflow's read-only **inspect** and **plan**
   operations. Confirm both projects/team, alias, host-conditional proxy, origin,
   DB fingerprint and expected change list. Do not infer masked settings from a
   Ready badge. Keep Deployment Protection on and bypass secrets in GitHub.
3. If an index change is required, separately run database preparation
   **dry-run**. Review conflicts/normalization/topology/fingerprint. An owner must
   authorize the separate **apply** operation with exact confirmations. Startup
   never seeds, creates indexes or repairs existing accounts. This milestone
   adds **no indexes** and needs no index apply.
4. Obtain approval for the concrete staging deployment plan, then use the
   existing **deploy** workflow on the approved main SHA. Retain its partial-state
   record if any step fails; do not blindly rerun. Preserve the existing alias.
   The workflow owns the dedicated API `APP_ORIGIN` update/redeployment and
   before/after-change HTTPS assertions; do not skip either stage.
5. Verify TLS without redirects, homepage/deep links, JSON content types and
   no-store API caching, wrong fingerprint 409, correct staging health 200 and
   anonymous `/api/me` 401. After the API origin change, verify cookie/CSRF
   behavior through the guarded browser workflow. Preflight uses a header and
   browser tests use the supported host-only HttpOnly bypass cookie, with no
   credentials in URLs, screenshots, traces or logs.
6. Run the existing explicit E2E **preview**, then separately approved **run**.
   Preserve the approved fingerprint and ceilings: four synthetic accounts, two
   plans, six items, eight pickup requests/eight issued sessions, two owned
   expiry updates. Keep the receipt; invoke only **cleanup** for that receipt/run.
   Verify cleanup evidence without dumping documents. No demo seed, broad delete
   or write to unrelated data is part of verification.

The new accessibility checks run on disposable **local** data in normal PR CI;
they are skipped in remote E2E, retaining its original budgets and behavior.

## Additional gates before any production launch

- Owner approves a distinct production inventory: API project, DB/user scope,
  secret scope, exact HTTPS frontend origin, target fingerprint, network policy,
  backup location/keys and recovery owner. Do not fill gaps with staging values.
- Independently review frontend **and direct API** protection, every alias and
  host route. Frontend Deployment Protection alone cannot guard a reachable API;
  CSRF is not an account-creation invitation system. Do not expose registration
  or remove protection as part of this milestone.
- Verify durable Atlas connectivity, resource/abuse limits and the restore drill
  below. Review Hobby eligibility/terms and current quotas before public use.
- Resolve or explicitly accept dependency findings against a documented threat
  model; complete manual accessibility and user-journey checks below.
- Approve a release window, bounded verification data and rollback trigger. The
  existing HTTPS E2E tooling deliberately rejects Production and must not be
  pointed at it. A future production smoke check needs its own reviewed read-only
  contract. Never loosen staging safeguards to reuse its write tests.

## Health, diagnostics and failure response

| Signal | Meaning / action |
| --- | --- |
| `GET /api/live` 200 `{status:"alive"}` | Hosted handler can answer; no MongoDB connection or readiness claim. No-store. A supplied target fingerprint still requires live verification and can return 409/503. |
| `GET /api/health` 200 | Runtime initialized with required indexes and transaction topology; current target inspected and ping succeeded. Existing `status`, `environment`, `databaseFingerprint` keys are unchanged. Not a complete inventory/backup/continuous-index audit. |
| 409 `DEPLOYMENT_CHANGED` | Stop verification/writes. Compare the approved target through read-only inspection; never overwrite the expected fingerprint merely to pass a check. |
| 503 + `Retry-After: 5` | Configuration/startup/DB readiness failed. Keep protection on, inspect sanitized phase/category and provider status; do not add firewall rules or recreate indexes blindly. |
| `SEARCH_BUSY` / `DISCOVERY_BUSY`, 429 | Narrow queries/wait. Repeated events require capacity/abuse investigation, not automatic scale-up or retries of writes. |
| Frontend `REQUEST_TIMEOUT` after 15 seconds | The write may already have committed. Refresh/read current state before deciding to resubmit. No automatic write retry or logout occurs. |

Every app/hosted response has a server-generated `X-Request-Id`. Caller IDs are
ignored. Request logs contain method, correlation ID and status, not URL/query,
headers/cookies, body, user identity, driver text or connection strings. Hosted
startup/readiness failures include only allowlisted phase/category; identical
failures are throttled for 30 seconds **per warm instance**. A successful cold
start includes duration. This is lightweight diagnosis, not centralized alerting
or a security audit trail.

Categories distinguish configuration, target configuration, unavailable required
indexes, unsupported transaction topology, app initialization, MongoDB code 18
authentication and code 13 permissions. Other failures deliberately remain
`database_unavailable`: distinguish DNS/TLS/network/outage with safe provider
status and the existing read-only DB dry-run, not raw driver logs. Error-category
matching is indicative, not proof that a provider firewall is the cause.

The hosted driver uses one shared initialization/pool per warm instance, pool
maximum 10, minimum zero and 60-second idle cleanup; connection selection,
socket establishment and pool-queue waits each have a 5-second deadline. These
are separate waits, not a five-second end-to-end SLA. Concurrency can multiply
instances/pools and monitoring connections. Native driver recovery remains;
requests do not create a client each time or automatically replay app writes.
The readiness check is not a load test and should be polled modestly.

Initially the owner should review failed Actions/deployment notifications and
Vercel/Atlas dashboards after releases and periodically thereafter: sustained
5xx/timeouts, 429 increases, DB storage/connections, cold-start duration and quota
consumption. Decide monitoring cadence/thresholds, log retention and an incident
contact before launch. No paid monitoring or unattended write automation is added.
For an incident: preserve only sanitized metadata, identify the release/target,
keep protection enabled, stop synthetic writes, and choose approved rollback or
maintenance. If credentials are suspected compromised, have the owner rotate
only the affected scope; do not paste them into tickets.

## Atlas access and least privilege

**Observed by owner:** M0, MongoDB 8.0.34, IDLE/not paused; staging runtime role
`readWrite` only on `moveout_e2e_staging`; one individual-IP rule and a temporary
`0.0.0.0/0` rule with expiration not verified. No settings were changed here.

Standard Vercel serverless and standard GitHub-hosted runners do not provide one
durable caller IP to copy into Atlas. One observed IP, all GitHub/Azure ranges or
an unattended extension of the broad temporary rule is not a durable narrow
policy. Database passwords/TLS remain essential even with network restrictions;
neither replaces the other.

| Option for owner review | Cost / coverage / limitation |
| --- | --- |
| Explicit short staging window with confirmed expiration | Temporary testing only; broad public network reach persists during the window. No automatic renewal. Does not meet a durable launch access decision. |
| Already available owner-controlled fixed-egress host/runner | Can restrict backup and GitHub runner access without new infrastructure if such a host exists; does **not** solve Vercel API egress. Requires host patching and secure secret storage. |
| Provider static egress/private networking | Evaluate Vercel and Atlas plan/tier/region compatibility and price. May require paid resources; no purchase or change is authorized. |
| Explicitly accepted public network reach | Security trade-off requiring a specific owner decision, credential/monitoring controls and continuing review; not an automatic recommendation or implicit launch approval. |

Review the actual rule expiration and both entries in Atlas before the next
approved hosted test; connectivity can stop when a temporary rule expires.
Confirm the runtime role can read/write only its DB and cannot administer other
DBs; scoped `readWrite` is still broader than a custom least-privilege runtime
role. Keep administration and backup credentials separate if approved. Index
administration and user/network management are not startup duties. Custom roles,
rotation, access-list changes and tier changes require verified targets and owner
approval. No production privilege claim follows from the staging user's role.

## Low-cost backup and isolated restore proposal

Atlas managed backups are **not available for M0/Free**. Do not assume PITR,
automatic snapshots or a tested recovery path. A replica set is not a backup.
Free clusters may pause after 30 days of inactivity; provider pause-recovery
behavior is not a backup service or a substitute for owner-controlled exports.

Proposed first step, requiring owner approval: use an existing encrypted local
volume and supported MongoDB Database Tools to export **only** the verified
staging DB. Keep an encrypted second copy on a separate already available
medium if possible. Agree retention (for example seven daily/four weekly copies),
access, key recovery and deletion first; backups contain private data and session
hashes. No archive should be committed, uploaded as an unencrypted Actions
artifact, or sent through chat. Free existing storage is not assumed to exist.

1. Choose the export owner/secure machine and approve any required temporary
   network access separately. Securely provision a private Database Tools YAML
   config on that machine (mode `0600`, outside the repository) using its
   supported `uri`/password fields; never place credentials in command arguments,
   shell history or logs. Review compatible Tools/server versions.
2. With securely configured environment variables, use the existing DB
   preparation **dry-run** to confirm staging/database/fingerprint/topology and
   index compatibility. Abort on mismatch. Arrange a verified no-writes window:
   a logical M0 export is not an atomic cross-collection PITR snapshot. Do not
   assume `mongodump --oplog` is supported for this Free cluster.
3. On the approved encrypted volume, execute the DB-scoped command below using
   private operator-selected paths. Do not put an actual URI in the command.

   ```bash
   mongodump --config /private/staging-tools.yml --db moveout_e2e_staging \
     --archive=/encrypted-backups/staging-approved.archive.gz --gzip
   sha256sum /encrypted-backups/staging-approved.archive.gz
   ```

   Keep a nonsecret manifest alongside the encrypted archive: release SHA, UTC
   export time, Tools/server versions, source fingerprint, checksum and aggregate
   collection counts. Export/manifest verification must not print documents or
   emails. End the no-writes window only after success/failure is recorded.
4. Approve a separate restore drill into a **new empty disposable local replica
   set**. Verify its owned container, loopback endpoint, process identity and
   empty destination before writes, as the isolated test helper does. Use a
   different private config that connects **only** to that target; never reuse
   the staging config as the restore destination. Reject existing namespaces.

   ```bash
   mongorestore --config /private/isolated-local-tools.yml \
     --archive=/encrypted-backups/staging-approved.archive.gz --gzip \
     --nsInclude='moveout_e2e_staging.*' \
     --nsFrom='moveout_e2e_staging.*' --nsTo='moveout_restore_approved.*'
   ```

   This command creates documents and indexes in the approved local destination;
   it is illustrative, not executable approval. Never use `--drop` or point it
   at a populated/production database. Review archive metadata and namespace
   mapping before execution; abort unexpected collections or index conflicts.
5. Check counts, user/plan/item/request ownership relationships, inventory/pickup
   invariants, unique/TTL/partial indexes and required topology. Any guarded
   index dry-run must name the **restore target**, not the old source fingerprint.
   Before any separately approved cutover, revoke restored sessions on that
   verified destination and require fresh login. Do not expose production private
   records to general PR CI; use owner-controlled access for a real-data drill.
6. Record measured restore duration and results; securely remove only the owned
   drill resources when approved. Recovery point is the last **verified** export;
   a daily schedule is only a proposal and no RPO/RTO is promised before a drill.
   A production recovery/cutover needs its own approved destination and plan.

No export, restore, credential, network or backup configuration change is part of
this PR. This proposal provides a low-cost path while clearly retaining the
cross-collection consistency and owner-key-loss limitations of logical backups.

## Rollback checklist

1. Record the failing deployment SHA/phase and sanitized request IDs. Stop
   verification writes and keep protection enabled. Do not change Atlas access
   rules as a speculative fix.
2. Identify the previous **same-environment** frontend/API deployments and
   nonsecret `APP_ORIGIN`/route configuration from the release record. Obtain
   owner approval for the exact alias/API/config change before executing it.
   Reverting Git code alone does not restore provider environment settings.
3. For staging, preserve its existing alias and host-scoped proxy; restore only
   the approved Preview deployment/API version and matching origin. Re-run
   read-only fingerprint/HTTPS checks before any separately approved bounded E2E.
   Never attach staging to the frontend Production alias.
4. For eventual production, use separately approved production resources and
   previous production artifacts. Never route Production to staging as fallback.
   Coordinate frontend/API cookie/CSRF contracts; keep HTTPS/protection enabled.
5. A code rollback does **not** undo user data, account changes, index changes or
   previously committed pickups. This milestone adds no schema/index migration.
   If future schema compatibility fails, stop and design a verified-target
   recovery; do not automatically drop indexes, restore over data or replay writes.
6. Cleanup is scoped to the E2E receipt/owned IDs and requires its existing
   confirmations. Record partial deployment state and cleanup evidence, even if
   rollback is deferred. Production data is never synthetic cleanup scope.

## Capacity, dependencies and user acceptance

Observed provider plan is **Vercel Hobby**; Atlas is **Free M0**. Neither supplies
an application availability guarantee. Review current Hobby usage eligibility
(including non-commercial restrictions), function duration/concurrency, bandwidth,
CPU, build/deployment quotas and Atlas shared-tier storage/connection/throughput
limits against intended use. Quotas and pricing change; do not infer capacity
from two synthetic users or invent a request-volume promise. No paid upgrade is
approved. Cold starts, shared-tier throttling, inactivity pauses and regional
latency are expected risks. Maintain headroom for per-instance pools.

Private plan/inventory list sizes, plan-scoped transaction scans, session creation,
unpaginated legacy gift lists and lack of account/item quotas can amplify abuse
or large-account resource use. Main discovery is paged/bounded and pickup lists
are paged, but this does not establish a global workload budget. Measure before
setting quotas or changing business contracts. Current in-memory IP limits are
per process, and proxy identity has not been validated; do not enable unrestricted
`trust proxy` or trust client-supplied forwarding headers.

The compatible React Router 6.30.6 patch avoids a router major migration. Remaining
moderate router advisories include backslash redirects and SSR error hydration;
the app uses client-only BrowserRouter and fixed/internal links plus validated
post-login paths. This reduces applicable paths but is not a clean dependency
audit. CRA/build/test advisories and a future compatible router remedy require
tracked triage/owner disposition. Build jobs should continue having no application
or production credentials. Do not run `npm audit fix --force` as a launch step.

Automated axe checks cover anonymous home/discovery/login/register in desktop and
mobile Chromium plus keyboard skip/menu focus. Existing local and hosted E2E
cover two-account auth, plan/inventory, discovery and pickup/handoff states.
Before a public MVP, manually verify keyboard-only forms/dialogs, screen readers,
200%/400% zoom/reflow, error announcements, real mobile touch/virtual keyboard,
Safari/iOS date/time controls, expired sessions and uncertain write outcomes on
slow/disconnected networks. Authenticated pages, populated results, native date
pickers and all dynamic states are not fully certified by the anonymous axe scan.
Legacy demo screens need the same review. Contact/rendezvous clarity without
messaging, account-recovery/support, retention and abuse handling require owner
product decisions; this milestone adds none of those features.

## Provider references

- [Atlas backup limitations](https://www.mongodb.com/docs/atlas/backup-restore-cluster/)
  and [Free-cluster restore/pause behavior](https://www.mongodb.com/docs/atlas/backup/restore-free-tier-cluster/).
  Official source reviewed at MongoDB docs commit
  `d612dac29b15054eea6d0781b52c604d1f6d82c3`; Free backups are explicitly unavailable.
- [Database Tools mongodump](https://www.mongodb.com/docs/database-tools/mongodump/)
  and [mongorestore](https://www.mongodb.com/docs/database-tools/mongorestore/):
  verify supported options and server compatibility at execution time.
- [Vercel Hobby](https://vercel.com/docs/plans/hobby),
  [limits](https://vercel.com/docs/limits) and
  [Functions limitations](https://vercel.com/docs/functions/limitations):
  owner must verify current eligibility/quotas; no unverified numeric SLA is used.
