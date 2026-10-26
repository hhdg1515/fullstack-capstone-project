# Milestone 6.2 Phase 4 — Communication security and readiness

Status: engineering review and isolated verification only. Nothing in this audit
approves a hosted deployment, remote database operation or public launch.
This documentation PR depends on [Phase 4A #40](https://github.com/hhdg1515/fullstack-capstone-project/pull/40).
Review/merge #40 first, then retarget the documentation branch to main.

## Scope and baseline

Reviewed merged main `e9e1b842ad207081c6cdcf6931fd2a9fc136e786` (PRs #36–#39).
This is a manual, source-backed scoped audit, not an exhaustive penetration test
or completed Codex Security scan: the packaged scan references/tools were not
available. No remote endpoint, Atlas target or provider control plane was queried.
Infrastructure observations in [Milestone 6.0](production-readiness.md) remain
historical owner/provider findings, not newly verified configuration.

Before changes, backend lint and **257 tests**, **238 frontend tests**, strict
production build, **56 deployment/E2E policy tests** and **20 local HTTPS browser
tests** passed. Tests own verified disposable Docker replica sets; they do not
accept an inherited development/remote MongoDB URI. Browser fixtures cover
desktop and 320px chat/scheduling layouts, with automated WCAG A/AA checks.

Boundaries reviewed: `middleware/identity.js`, `services/identity.js`, auth/input
routes, `app-factory.js`, `logger.js`; pickup communication/policy/service/routes;
database/index preparation, hosted initialization and pool management; chat and
scheduling components/API client; Actions authorization, policy and owned cleanup.
The existing conversation, rescheduling, identity, preparation and hosting tests
provide regression evidence. This is not an independent cloud configuration audit.

## Prioritized findings

Critical: **none demonstrated** in the reviewed paths. No High authorization,
CSRF, sender-impersonation or cross-conversation disclosure exploit was found.
That is scoped evidence, not a claim that the application is vulnerability-free.

| Severity | Evidence / impact | Disposition |
| --- | --- | --- |
| Medium, verified abuse gap | A new independent app instance accepted message 31 after another instance accepted 30 for the same account. Per-process stores cannot enforce a shared quota. | Fixed: account-scoped MongoDB successful-send budgets, 30/60 seconds and 300/3,600 seconds, in the existing send transaction. Tested across instances, sessions, conversations and concurrent different-plan transactions. |
| Medium, verified resource gap | Pickup authentication preceded its IP limiter; invalid well-formed session tokens incurred a database lookup without consuming that limit. | Fixed: existing 120/minute per-process limiter runs first. Regression proves request 121 returns 429 without another authentication lookup. Still no global request-rate guarantee. |
| Low, verified execution-bound gap | History was page-bounded and indexed but had no server query deadline. | Fixed: five-second page-query maximum, explicit projection and sanitized 503 `CONVERSATION_BUSY`. Not an end-to-end transaction timeout. |
| Medium, residual public-launch risk | Auth/GET/scheduling attempt limits are memory-local. Account creation has no verification/anti-Sybil gate; multiple accounts can multiply successful-send allowances. Trusted proxy/client-IP behavior is unverified on the host. | Intentionally deferred: retain Deployment Protection; owner chooses a launch exposure/abuse policy and verifies ingress/IP behavior. No unverified `trust proxy`, CAPTCHA, external store or provider setting was added. |
| Medium, verified privacy/storage gap | Messages have no retention expiry or deletion cascade; inaccessible orphan messages remain stored. No account-deletion API or tested recovery/erasure procedure exists. | Owner decision required; proposal below. No deletion, TTL or migration implemented. |
| Medium, known reliability tradeoff | A POST can commit before its response is lost. A deliberate resend creates another message. | Existing draft retention, explicit read/review and no automatic POST retry remain. Server idempotency needs a separate reviewed client-ID/unique-index/replay contract; content-based deduplication would silently discard legitimate messages. |
| Low, prospective capacity risk | Every send touches the shared plan revision; scheduling history grows in the canonical request and inventory invalidation reads active requests. Repeated rescheduling needs the other participant to resolve each proposal. | No observed corruption or capacity failure. Measure retries, document sizes and active-request counts before broader use; no fabricated throughput claim, new history policy or lifecycle rewrite. |
| High, deployment blocker, not a demonstrated exploit | Phase 1's remote `pickup_messages_request_time` preparation is still unapproved/unverified here. New cold startup must fail without it. | Local missing-index readiness returns 503 without creating the index. Require separately approved remote preview/apply before deploying this revision. |
| High, public-launch gate | Durable Atlas access, recovery and production configuration remain unresolved. Current dependency metadata includes critical/high build-tree advisories. | Carry forward Milestone 6.0 launch gates. Remote configuration and browser reachability of each advisory are not certified by these tests. |

Existing safeguards held in regression tests: hashed expiring/revocable sessions,
Secure HttpOnly host cookies in production, exact Origin plus non-simple CSRF
header on JSON writes, backend-only identity/ownership checks, generic 404s for
unavailable conversations and explicit role-only participant/message DTOs. Private
email, hashes, tokens and message text are absent from public responses/logs.
Closed requests remain read-only to original participants with valid references;
deleted/compromised requests/items/plans/users fail closed. No privacy promise is
made against a database administrator or compromised server: text is not E2EE.
The existing JSON cap is 32 KiB (413), with trimmed 1–2,000 Unicode-character
plain text, strict field/type validation and markup/control rejection (400).
Structured injection/impersonation fields never become database predicates or
sender identity. Invalid/foreign cursor tests retain generic authorization
failures for nonparticipants; cursor encoding is not an authentication secret.

## Implemented bounds and compatibility

See [the API/implementation contract](milestone-6.2-communication.md#phase-4--shared-message-bounds).
Two counters in the existing account initialize lazily during an authorized send.
The MongoDB clock controls anchored expiry windows; bursts can straddle a boundary.
Atomic reservation and insertion abort together, including cancellation races,
insert failure and transaction callback retries. Quota 429s include bounded
`Retry-After`/`retryAfterSeconds`; the frontend keeps text without promising that
an hourly limit resets after a minute. No account fields besides quota metadata
change. No new index, dependency, collection, schema migration or startup write.

Local attempt limits can reject an invalid attempt, while database quotas count
only committed sends. GETs remain participant-checked, snapshot-consistent,
cursor-bound, limited to 20 by default/50 maximum plus one lookahead. They are not
globally throttled. Pagination is stable by UTC timestamp/ObjectId, including
equal-time messages and new arrivals. The five-second query maximum does not
bound all authentication reads, pool waits, transaction retries or commit outcome.
The existing frontend abort is 15 seconds; it cannot undo a server commit.

Hosted instances still reuse one native pool, maximum 10 connections plus driver
monitoring overhead, with five-second selection/connect/pool-wait bounds and no
new per-request client. Aggregate connections scale with warm instance count.
MongoDB driver transaction retry behavior is unchanged; there is no verified
whole-request latency SLA or production load test. API history deadlines return
sanitized errors; request logs remain method/status/random correlation ID only.
Raw errors, query text, message bodies, cookies and private identifiers are not
diagnostic fields. Existing log volume remains proportional to requests.

## Proposed message lifecycle — owner approval required

**Recommendation, not implemented policy:** retain active conversations while
their request is legitimately pending/accepted; retain closed messages for **90
days after the canonical terminal event**, then delete only that request's message
documents. Ninety days gives a limited coordination/issue-review period instead
of indefinite plaintext retention; it is a product choice, not a legal requirement.
Use existing terminal history/timestamps, not an unrelated `updatedAt`, as the
closure source. Inconsistent/missing history requires review, not guessed dates.

| Situation | Current enforced behavior | Proposed decision / safe implementation |
| --- | --- | --- |
| Active request | Eligible original participants read/send; expiry/ownership checks apply. No automatic erasure. | Do not delete a still-active request's messages merely because its appointment passes. Review stale active records and separately decide expiry/closure policy. |
| Closed request | Original participants can read; cannot send. History has no expiry. | Approve the 90-day window and clear UI notice before any purge; retain lifecycle records separately under an approved request-record policy. |
| Account deletion request | No self-service deletion endpoint. Missing user revokes session authentication and denies both parties conversation access; stored text remains. | Choose full conversation erasure vs reviewed redaction, requester verification, response time and narrow abuse/legal holds. Do not equate deleting a user document with deleting messages. |
| Deleted request/item/plan or broken ownership | API denies history; orphan text is not erased. | After approval, preview exact owned request/message IDs and counts; bounded manual purge with fresh reference checks. Never broad collection deletes or silent repair. |
| Investigation | Application-readable text; no new moderation/export/admin UI or special access endpoint. | Designate minimal authorized operator access, audited case handling and explicit bounded holds. Do not create an indefinite blanket exception. |
| Backup/restore | No verified backup/restore or erasure lifecycle. | Approve encrypted storage/access/expiry. Deletion may survive in backups until their expiry; keep a minimal deletion ledger outside restored data and reapply approved deletions before access resumes. Test this privately on an approved empty restore target. |

Stored data: message ID, canonical request ID, sender ID, plaintext text and UTC
creation time; existing request lifecycle/appointment history remains separate.
Quota metadata stores counts/expiry, not message content. Access ends when session
authentication or canonical participant/reference checks fail; closing alone does
not end reading. **Nothing currently deletes messages automatically.** Normal
test cleanup owns disposable containers. Remote cleanup only covers its existing
bounded synthetic entities, not message content. No message TTL/index is proposed
for automatic execution: TTL would need redundant expiry maintenance and can
silently erase active history if derived incorrectly.

After owner approval, prefer an explicit read-only lifecycle report followed by a
separately confirmed, bounded request-scoped maintenance command using existing
collections. It must recheck target/fingerprint, eligibility and holds before each
approved batch; do not add a worker or new retention collection speculatively.
Approve the window, account deletion semantics, holds, notice, backup lifetime,
recovery owner and deletion evidence before implementing that irreversible step.

## Resource assessment (assumptions, not provider pricing)

Native-driver BSON sizing of the current message shape measured **597 bytes**
for 500 ASCII characters and **8,097 bytes** for 2,000 emoji. These exclude index,
WiredTiger allocation/compression, replicas, backups and transport overhead.
The default `_id` and request/time/ObjectId indexes each add an entry per message;
measure their actual storage with an approved DB-scope inspection rather than
guessing a multiplier.

Assume 100 pickup conversations/day, 20 messages total each, 500 ASCII characters
average: 2,000 documents/day, **1.194 MB/day**, or **107.46 MB/180,000 documents**
over 90 days of closed history. At maximum four-byte characters that payload is
**16.194 MB/day / 1,457.46 MB per 90 days**. Active history and the unimplemented
retention policy add beyond those examples. A 300/hour account limit can still
permit about 7,200 sends/day/account under sustained activity; multiple accounts
multiply it. The quota reduces bursts, not total retained storage.

Without retries/fingerprint checks, one send has nine service CRUD operations
(including one new account update) plus two session-authentication reads and one
transaction commit. One rejected quota also performs a bounded account lookup
to calculate retry delay before abort. A full initial/manual chat refresh makes
two HTTP requests: context and page, totaling 13 CRUD reads and two snapshot
commits including authentication. Therefore 2,000 refresh actions/day imply
4,000 function invocations and roughly 26,000 CRUD reads plus 4,000 commits.
History pagination adds one HTTP request, not an automatic polling loop.

These are code-path counts, not measured bills/latency. Driver monitoring, cold
start/index checks, hosted fingerprint checks, failures/retries, scheduling and
other application use add work. Plan-lock conflicts and account quota contention
increase retries; quota rejects still cost authentication/authorization work.
Manual refresh and existing page/size bounds remain useful low-cost choices.
Monitor allowed status counts, transaction retries, storage/index sizes and warm
pool counts without recording identities/text. Verify current Atlas/Vercel plan
eligibility, limits and pricing before launch; no provider quotas/costs are invented.

## Future hosted sequence — none executed here

1. Owner reviews/merges the code PR, then the dependent audit PR. Record exact
   merged SHA, green normal CI, prior deployment IDs and rollback revision.
2. Separately authorize a **remote dry-run**, on reviewed main, of **Prepare
   staging database indexes** in `isolated-e2e`. Existing secret `E2E_MONGO_URL`
   and variable `E2E_DB_NAME` feed the command; no frontend origin is required.
   Confirm staging name, actual topology and fingerprint against the approved
   target in `deployment/staging-target.cjs`, and inspect all planned operations
   and conflicts. No credentials in chat, workflow inputs, logs or artifacts.
3. Only after reviewing that preview, approve a separate **apply** dispatch with
   exact SHA, `confirm_db=moveout_e2e_staging`, `confirm_environment=staging` and
   the full matching `confirm_target`. The utility rechecks live target/conflicts
   and creates only existing application-defined indexes, never repairs accounts
   or seeds gifts. A new dry-run should show required indexes kept. Stop on any
   unexpected operation/target; local fingerprints are not remote approvals.
4. Separately authorize the existing staging **inspect/plan**, review changes,
   then **deploy**. Preserve the current test alias, dedicated staging API,
   approved DB fingerprint and host-scoped proxy. Keep production routes and
   Deployment Protection intact; update API `APP_ORIGIN` only through its existing
   approved workflow. Require the before/after-origin HTTPS assertions.
5. Check JSON/no-store readiness, wrong-fingerprint 409, correct staging 200 and
   anonymous `/api/me` 401 with existing secret-safe bypass handling. New cold
   startup checks indexes; a prior warm health 200 is not continuous index proof.
6. Existing owner/main/SHA/fingerprint-gated HTTPS E2E **preview/run/cleanup**
   remains unchanged. **It does not verify hosted chat/rescheduling**: the new
   browser scenarios remain local-only. Before approving hosted Phase 6.2 tests,
   separately review message/proposal budgets, ownership and message cleanup so
   no orphan content is left. Never silently enlarge the current remote budgets.
7. On failure, keep the partial deployment receipt and protection; do not blindly
   rerun POST/deploy. Owner-authorized rollback restores the compatible prior
   frontend/API pair. Keep the additive index/quota fields; do not drop indexes,
   erase messages or normalize accounts. Older code ignores quota metadata but
   loses shared enforcement, so rollback must remain protected pending review.

The generic CLI supports explicitly confirmed production administration; the
staging workflow is intentionally narrower (manual main/exact SHA, staging name,
environment and confirmation inputs). Names alone do not prove physical target;
review the fingerprint and credential scope. E2E additionally pins its approved
fingerprint and trusted owner actor/rerun context. Environment access/repository
write permissions and administrators remain trust boundaries; no workflow can
defend itself against someone authorized to rewrite it or replace its secrets.

## Verification and remaining gates

Implemented/tested: shared successful-send quota, early pickup attempt limiting,
bounded projected history query, sanitized failures, draft retention, lazy additive
metadata and missing-message-index fail-closed readiness. Final checks: **270
backend tests**, **239 frontend tests**, strict production build/lint, **56 policy
tests**, **20 local HTTPS browser scenarios**, authenticated WCAG A/AA checks,
actionlint and whitespace checks. CI links and immutable heads are in the PRs.
The first expanded browser run found two transient contrast failures while error
focus scrolled a Bootstrap control under the pointer; the feedback-state audit
now waits for existing hover transitions to settle. No CSS change, hidden element
or disabled accessibility rule was used. New fixture-clock mistakes were also
corrected without weakening the publication/eligibility checks.

Current dependency audit: backend `npm audit --omit=dev` exits 0, **0 findings**.
Frontend full-tree `npm audit` exits 1: **386 findings (112 low, 170 moderate, 93
high, 11 critical)**. CRA includes build/test tools in this tree. Metadata is
time/service-sensitive and does not establish 11 reachable browser exploits;
reachability/remediation/accepted risk still need a focused review before public
launch. No dependency or lockfile changed and no force upgrade was attempted.

Owner decisions: retention/deletion/backup handling, durable Atlas access and
recovery, production inventory/protection, dependency disposition and public abuse
exposure policy. Optional later work: measured contention tuning, end-to-end
operation time budget, idempotency, request-history bounds, stronger human/mobile
accessibility testing and moderation/reporting. No high-traffic capacity claim.

Remote approval required: index preview/apply, any hosted deployment/API-origin
change, expanded bounded hosted communication verification, cleanup and recovery
drills. Public launch remains blocked by the earlier operational gates and the
unapproved privacy lifecycle. No remote E2E, data/index, provider/secret/network,
merge or deployment action was performed. All 16 demo gifts and existing CI and
remote isolation/cleanup safeguards remain intact.
