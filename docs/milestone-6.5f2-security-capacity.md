# Milestone 6.5F2 — Dependency security and photo capacity

Base: merged #71/main `a72915ea8536b34054302687277c1f8de36af1ab`.
Branch: `codex/m65f2-dependencies-photo-capacity`. Evidence date: 2026-10-30 UTC.

## Outcome and boundary

This PR patches selected dependency families and removes the **warm-pipeline**
photo ceiling through ticket-scoped storage clients. It does not enable photos,
alter a user quota, prune/archive/erase metadata, migrate a schema, add cleanup jobs
or access Atlas/R2. F1 signatures, target fencing and local receipts are unchanged.
Ordinary startup still refuses R2/pipeline activation. All production photo gates
remain disabled. No hosted E2E or manual deployment is performed.

## Reproduced dependency evidence

The committed lockfiles were installed with `npm ci`, Node 22.23.4/npm 10.9.9.
The initial local install could not write the inherited npm cache; retrying with
an isolated `/tmp/f2-npm-cache` succeeded without changing TLS/proxy trust or locks.
Audits are registry reports at a point in time, not permanent security guarantees.

| Scope | Before | After | Audit exit before / after |
| --- | --- | --- | --- |
| Backend complete installed tree | 5: 4 high, 1 moderate | **0** | 1 / 0 |
| Backend `--omit=dev` | **0** | **0** | 0 / 0 |
| Frontend complete installed tree | 387: 11 critical, 92 high, 170 moderate, 114 low | **67: 0 critical, 27 high, 18 moderate, 22 low** | 1 / 1 |

These are **affected package entries**, including inherited severity on consuming
packages. They are not distinct CVEs, confirmed application attack paths or counts
of exploitable vulnerabilities. Frontend `--omit=dev` is not a browser-runtime
audit: CRA's build/server/test tools are declared through production dependencies.

[Raw before/after audits and derived inventory](verification/m65f2/) include all
remaining advisory IDs, severities, affected ranges, direct/transitive locations,
consumer execution classes and lock hashes. [The lock delta](verification/m65f2/lock-delta.json)
shows four backend paths changed/removed and 71 frontend paths changed/added/removed.
The latter are the selected packages and their required toolchain children
(including Webpack's WASM parser/resolver/minifier family), not a framework swap.
CRA 5.0.1, React 18 and React Router 6 remain at their existing versions.

### Exposure and reachability

| Execution boundary | Actual evidence / interpretation |
| --- | --- |
| Production backend | No reported runtime dependency advisories before or after. JSHint/Mocha/serializer overrides are development/test-only; no production dependency version changed. This is not proof of absence of application vulnerabilities. |
| Browser-delivered JS | Fresh strict builds and production source maps before/after observe **react-router / react-router-dom** among the audited package names. Other affected installed packages are not observed as package modules in that output. Source-map absence is not proof of nonreachability: generated/inlined code and different future configurations need review. |
| Generated browser code | Webpack is a build tool that can emit vulnerable browser runtime code. Its DOM-clobbering gadget cannot be dismissed merely because Webpack itself is not a browser module. The compatible compiler update addresses the upstream range; buildHttp SSRF depends on an experiment not enabled by this CRA configuration. |
| Build-time tools | Webpack/minifiers/Babel/SVGO/Workbox process source, options and assets. Current assets/config are repository-controlled; no user SVG/code/config upload path exists. A malicious checked-out PR already executes build/test code, so CI isolation/secret separation remains essential. |
| Development server | launch-editor, shell quoting, proxy-addr and websocket-driver affect the local development server/editor/proxy/handshake boundary. Patches are applied, but native Windows editor behavior and hostile-network exposure are not certified by Linux tests. |
| Test tooling | Mocha parallel workers and Rollup/Terser really serialize options; JSDOM/form-data are Node test/network helpers. They are not shipped as backend API handlers or browser multipart implementation. Tests exercise these actual consumer boundaries. |

The offline [package inventory](verification/m65f2/package-triage.json) traverses
lockfile consumer paths and records source-map observations. Its execution labels
are evidence aids, **not automated exploitability verdicts**. No new remotely
exploitable application HTTP vulnerability was established. This is a scoped
dependency/source review, not a penetration test or formal exhaustive scan.

### Narrow remediation decisions

| Target | Change / justification / compatibility evidence |
| --- | --- |
| JSHint's lodash | Scoped 4.18.1 override instead of vulnerable 4.17.23; same major, outside upstream's restrictive tilde. JSHint APIs/lint pass. A stale nested lock entry was removed and npm re-resolved it to the existing patched root; no integrity value was invented. |
| JSHint's minimatch | Scoped 3.1.5 instead of 3.0.8; same major, glob/ReDoS patches, original glob API and full lint retained. |
| Mocha serializer | Scoped serialize-javascript 7.1.3 instead of 6.0.2. Node >=20 is compatible with supported Node 22. Public value/options serialization and real two-worker Mocha parallel execution pass without upgrading Mocha. |
| Frontend Babel runtime / lodash | 7.29.10 / 4.18.1 within the existing major families. Patches helpers/tooling used by installed packages; neither package was observed as a package module in this production JS build. This does not exclude generated helpers. |
| Webpack | 5.104.1 is a same-major release beyond the three directly reported affected ranges. Required parser/resolver/minifier children move with it. Strict build, frontend and browser regressions verify CRA/plugin compatibility. No CRA migration or global graph refresh. |
| Minifier serializers | Legacy rollup-plugin-terser uses scoped serialize-javascript 7.1.3, deliberately crossing a transitive major. Webpack's required Terser plugin moves to 5.6.1 and uses a **vendored serializer**, not the external package override; both actual implementations receive benign injection/round-trip probes, plus real Rollup worker and strict Webpack minification tests. The Terser consumer override constrains any external resolution, but is not presented as fixing vendored code. Workbox's old consumer remains deprecated. |
| launch-editor / shell-quote | 2.14.2 / 1.12.0, same major families. Quoting API round trips and module compatibility pass; no shell/editor is launched. Windows-specific exploitation is not independently reproduced. |
| form-data | 3.0.5, same major. Synthetic field/filename CRLF can no longer introduce a multipart header; JSDOM/test tooling compatibility retained. Browser uploads continue to use native FormData. |
| proxy-addr / websocket-driver | 2.0.8 / 0.7.5, compatible family patches. Trusted/untrusted mapped-address behavior and real bounded loopback development WebSocket handshake/echo pass. No WebSocket feature is added to the marketplace. |

Exact consumer overrides are in the package manifests and pinned by lockfiles.
No `npm audit fix --force`, React/router major update or new dependency family is
used. All 49 original storage unit assertions remain unchanged.

[Benign isolated reproductions](verification/m65f2/benign-reproductions.json)
compare original package tarballs checked against baseline lock SRI with patched
modules. Old serializer RegExp flags executed a synthetic VM marker; patched code
did not. No shell, network or real data is involved. The chosen lodash array-path
probe was blocked by **both** versions; it did not independently reproduce that
advisory. Its upstream affected range was still patched. Neither probe establishes
that application HTTP input can reach those tooling APIs.

### Remaining advisories and decisions

The complete **67-entry** remaining inventory is committed, rather than hidden by
an allowlist or a passing frontend audit. Important families:

- **Browser / React Router:** upstream open redirect (`GHSA-wrjc-x8rr-h8h6`) and SSR
  error hydration (`GHSA-337j-9hxr-rhxg`) still affect v6. The reported fix is v7.18+,
  requiring a separate router-major compatibility review. This app's links are
  constructed from validated IDs/local routes, and `authDestination` requires
  `/app/`, rejects backslashes/control characters and auth loops. The app does use
  `createBrowserRouter`, but publishes no SSR hydration error payload. No untrusted
  input flow to those vulnerable conditions was demonstrated; the advisory is **not
  dismissed or represented as fixed**. New URL/SSR features would change exposure.
- **Older CRA tooling:** remaining high/moderate/low entries include deprecated
  SVG/loader/dev-server/test/compiler chains. Inputs/exposure differ from public
  API data; raw advisory conditions and consuming paths remain in the inventory.
  Some have same-family patch candidates (glob/Express/PostCSS/Workbox serializer
  chains); they are not all migration-only issues. This PR deliberately limits
  the changed families and records the remainder for consumer-specific follow-up
  tests. In particular, a separate Workbox serializer copy still appears in the
  audit; fixing minifier consumers is not claimed to fix every copy. Unsupported
  major overrides would require a separate API review. Keep development servers
  off public/LAN interfaces and do not treat loopback binding as a complete fix for
  cross-origin developer-tool attacks.
- **Maintenance direction:** plan a dedicated maintained-toolchain/router evaluation
  with an exposure matrix, migration alternatives, rollback and complete journey
  regression. Do not migrate CRA or the MERN architecture in F2. Owner review of
  remaining advisories is still a public-launch readiness item.

## Capacity strategy and implemented fix

| Limit / state | Meaning / F2 decision |
| --- | --- |
| Five Ready/held photos per item | Existing product/UX and resource quota; unchanged. |
| 50 daily attempts / 20 daily successes | Provisional abuse/resource quotas, not a new paid tier; unchanged, including consumed failed attempts. |
| 100 MiB account bytes / two concurrent uploads | Existing byte/concurrency admission bounds and authoritative charges; unchanged. |
| 1,000 retained operation records | Implementation/query/accounting bound that currently acts as a lifetime limit. Not silently converted to a product tier or increased. Owner-approved retention/schema/counter design is needed before lifting it. |
| Unknown PUT holds / tombstones | Correctness and privacy evidence, not disposable cache. Expiration, SDK close and elapsed time never release them. |
| 256 distinct PUT keys per storage client | Anti-replay/memory bound, unchanged in the adapter. The pipeline lifetime no longer equals the upload client's lifetime. |

`item-image-pipeline.js` keeps a shared read client and creates a **new upload
client only after a new durable ticket is claimed and variants prepared**. Both
conditional writes and verification GETs for that photo use it. It closes in
`finally`, including uncertain failures; teardown exceptions cannot leak a processing
slot or settle charges, and is removed from live-client tracking.
No key is evicted/reset in an existing adapter. Duplicate Ready/failed/processing
requests return canonical state before allocating an upload client. Fresh clients
cannot mint another durable PUT permit; the ledger is the cross-process authority.

The pipeline preserves an aggregate eight-storage-operation budget across read and
ticket clients, the global single native processor and eight read admission slots.
Closing the pipeline aborts/closes all its owned live clients; it does not settle
charges. F1 signature/DB/namespace/receipt/role validation still runs on each I/O.
Creating a client does not refresh an expired or changed signed approval.

This prevents a warm giver/community pipeline from permanently exhausting 256 keys.
It intentionally adds per-photo client/connection churn: real R2 TLS/latency/cost
must be measured before activation. It is not a fleet-wide throughput guarantee,
automatic retry mechanism or data-retention change.

### Stress and recovery evidence

- One warm pipeline processes **130 photos / 260 distinct PUT keys**, with **seven
  synthetic accounts**, no account exceeding 20 successes/attempts, at most five
  photos per item and bytes below the existing account quota. Every upload client
  closes after its two keys; only the read client remains. Repeating the first
  ticket in the same or a new pipeline issues no new PUT.
- Before-commit and committed/lost-response PUTs remain unknown across subsequent
  client creation. Negative reads cannot refund the first; matching committed
  bytes require explicit guarded recovery before settlement. Unrelated Ready
  photos remain intact, attempts and retained-record counts remain consumed.
- A **synthetic valid historical ledger** spans <=20 successes/day over many days;
  it is not evidence of 999 actual uploads/deletions. Concurrent admission at
  999 rows reaches exactly 1,000, then refuses new operations. Concurrent cleanup
  settles once, retains 1,000 tombstones and still refuses admission after day
  rollover. There is no hidden pruning/counter reset.

The high-volume test uses **real isolated MongoDB and Sharp plus a synthetic S3
wire service**, not a claim of 130 real R2/SeaweedFS uploads. Existing complete
SeaweedFS/R2-bridge, SIGKILL/lost-response, race, quota and recovery contracts also
run against the actual verified private SeaweedFS fixture. Provider behavior still
needs separate real R2 approval/testing.

## Retention/archival/erasure proposal — not implemented

See [the concrete decision packet](photo-operation-retention-proposal.md). No age
threshold, TTL index, deletion worker, archive bucket, migration, quota increase
or erasure workflow is introduced. The current ledger stays unchanged. Unknown,
charged, leased, unsettled or legally held records must never be pruned to regain
capacity. Compact replay receipts cannot simply replace today's strict schema:
B4 recomputes exact account charges/counts from retained rows.

## Verification and reproduction

```sh
npm --prefix giftlink-backend ci
npm --prefix giftlink-frontend ci
npm --prefix giftlink-backend audit --json
npm --prefix giftlink-backend audit --omit=dev --json
npm --prefix giftlink-frontend audit --json  # expected nonzero while 67 entries remain
npm --prefix giftlink-backend run lint
npm --prefix giftlink-backend test
npm --prefix giftlink-frontend run test:dependencies
CI=true TZ=America/Los_Angeles npm --prefix giftlink-frontend test -- --watchAll=false --runInBand
CI=true REACT_APP_BACKEND_URL='' npm --prefix giftlink-frontend run build
npm --prefix e2e run test:policy
npm --prefix e2e test
node deployment/dependency-evidence.cjs  # offline derivation from recorded snapshots
```

For before results use an isolated checkout at the baseline SHA and its original
locks; do not overwrite a working tree. Use an explicit writable npm cache only if
needed. Audits depend on the registry's current advisory dataset. The evidence
generator makes no network request; it records source-map observations and lock
consumer paths, not new scanner verdicts. PowerShell needs its own env syntax.

| Observed local gate | Result |
| --- | --- |
| Backend lint / complete suite | Pass / **626 passed**, including actual storage/R2 bridge, recovery and race cases |
| Focused capacity stress | **5 passed**; synthetic high-volume wire service, actual MongoDB/Sharp |
| Backend dependency consumer smoke | **3 passed**, including real two-worker Mocha |
| Frontend Jest | **444 passed / 23 suites** |
| Frontend dependency consumer smoke | **6 passed** |
| Strict build / policies | Pass / **56 passed** |
| Complete local HTTPS Chromium | **68 passed**, **214 axe checkpoints**, zero violations, no retries |
| actionlint / whitespace / original gifts | Pass; **16 gifts unchanged** |

The PR records immutable final CI run/head and all changed files. New backend compatibility tests execute actual Mocha parallel workers;
frontend Node tests run actual Rollup/Terser and a loopback handshake. CI adds that
six-test frontend compatibility step while retaining all original jobs/policies.
Production browser regressions use the actual strict build, isolated HTTPS,
synthetic users, disposable MongoDB and verified SeaweedFS. No hosted E2E is run.

## Remaining risks and rollback

Remaining dependency advisories/router/toolchain modernization, legal/retention and
support decisions, real R2/Vercel/Atlas contracts, coordinated restore, signing-key
custody/renewal, multi-instance admission, monitoring and physical Windows/iOS
validation remain in the [production checklist](photo-production-readiness-checklist.md).
Production photos are still not approved or ready merely because local/CI pass.

Rollback reverts the paired manifests/locks and pipeline lifecycle change together,
then runs `npm ci` and full checks. It restores known dependency debt and the old
warm-client limit; document that trade-off rather than silently deploying it.
No schema/data migration needs undoing. Keep F1/B4-compatible recovery, bindings,
charges, tombstones and disabled photo flags. Never roll back by resetting quota,
replaying uncertain PUTs, deleting records or broad object cleanup. All 16 original
demo gifts remain byte-for-byte unchanged.
