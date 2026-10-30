# Milestone 6.5F1 — Private R2 transport and recovery architecture

Base: merged main `daded8884b81b879ad4174d452fcf6379fee0edb` (#70).
Branch: `codex/m65f1-r2-transport-recovery`.

## Decision and activation boundary

F1 implements an R2-compatible transport, an explicitly constructed runtime
pipeline and an operator recovery entry. **It does not enable hosted photos.**
Ordinary `readServerConfig` still refuses pipeline activation, and now also
refuses any `ITEM_IMAGE_R2_ENABLED` value other than absent/`false`. All committed
environment templates keep metadata, pipeline, R2 and new-upload gates false.
No automatic startup import of the new context, provider I/O, DDL or maintenance
job exists. Merging this PR cannot activate these paths by changing an endpoint.

The separately approved real-provider milestone must review hosted wiring and
deployment inputs before removing that startup refusal. No R2/Cloudflare API,
Atlas, hosted E2E, provider setting, DNS or manual deployment is used in F1.

## Audit and boundaries preserved

B1's local config is an opaque WeakMap capability backed by a receipt and live
Docker verification on every I/O. It checks exact daemon/container/image/network/
volume, loopback port, bucket, namespace and synthetic credentials. F1 keeps that
validator and fixture unchanged. The local factory cannot accept an R2 config;
the R2 factory cannot accept a local config, even a disabled one.

The extracted `item-image-s3-core.js` retains B1's limits and behavior: only exact
variant keys and PUT/GET/HEAD/DELETE, fixed target wire checks, explicit credentials,
bounded streams/error XML, immutable `If-None-Match: *`, Content-MD5 and SHA-256
verification, no redirect/endpoint/credential fallback, and SDK `maxAttempts: 1`.
The original 49 storage unit regressions remain unchanged. Real local contracts
and all B4 failure tests still run.

B2/B3's schemaVersion 1 operation ledger, server-derived references, independent
image revision, account quotas, five-photo slots, immutable generation and durable
single-PUT permit are unchanged. Sharp sanitization, owner/session/CSRF checks and
D1/D2's current authorization rules use the same code. A transport timeout does
not release a permit or make a second PUT safe. Private storage remains private;
DTOs contain application image URLs, not signed provider URLs or storage keys.

B4's transaction/lease/recovery algorithm is shared without changing its decisions:
at most 25 operations, 100 object inspections, 120-second worker lifetime, 60-second
leases, ten-minute manifests and five cleanup claims. Unknown absent writes stay
charged. Exact verified absence after settled-writer/deletion evidence is required
for quota release; tombstones and lifetime/daily counters survive deletion.

## R2 target configuration and identity

`r2-image-storage-config.js` is separate from local configuration. It requires:

- Driver identity `r2-private`, explicit `staging` or `production`, matching
  `DB_ENVIRONMENT`, explicit non-system `MONGO_DB_NAME` and exact DB fingerprint.
- A 32-lowercase-hex account ID and the literal HTTPS origin
  `https://<account>.r2.cloudflarestorage.com`; region `auto`. No path, credentials,
  query, custom port/hostname, jurisdiction alias, local URL or AWS URL is accepted.
- An explicit 3–63 character lowercase/digit/hyphen bucket and
  `item-images-<same environment>-<32 hex>` namespace. Object keys add only the
  existing image ID, immutable generation and fixed variant filename.
- The exact SHA-256 target fingerprint over version/provider/account/environment/
  endpoint/region/bucket/namespace. Credentials/roles are excluded so approved
  rotation does not reinterpret existing ledger rows.
- Explicit R2-shaped access/secret credentials; no AWS credential chain. A signed
  receipt independently binds their fingerprint and the role. Runtime credentials
  should permit only scoped object reads/writes; recovery uses a different scoped
  read/delete credential. Application role restrictions supplement provider IAM,
  whose real policy must still be independently verified. Do not assume R2 can
  natively restrict methods/prefixes to exactly the application role; any broader
  token permissions need explicit risk review and compensating controls.

The template is [`.env.r2.sample`](../giftlink-backend/.env.r2.sample), **not an
activation recipe**. Metadata's existing storage fingerprint/namespace must exactly
match the approved R2 binding. No existing record is silently rebound or migrated.
Jurisdiction-specific R2 endpoints are deliberately unsupported pending a focused
contract review; the standard global endpoint is the only supported wire shape.

## Owner approval receipts

`r2-photo-approval.js` uses native Ed25519 signatures. The **offline operator** holds
the private signing key; runtime/recovery need only the verification public key.
There is no signing key in the API environment sample. No live key was created or
requested; tests generate temporary synthetic keypairs only.

A private receipt has an exact schema: version/approval UUID, runtime or recovery
role, environment, DB name/fingerprint, storage fingerprint, credential fingerprint,
issued/expiry UTC times and signature. Canonical signed fields, exact types, valid
signature, nonfuture issue time and unexpired lifetime (default one hour, maximum
24 hours) are required. Private file checks reject symlinks, unsafe ownership/mode
on Unix, oversized files and nonregular files. Windows ACL behavior remains unverified.

The receipt is an **operator authorization**, not fabricated evidence that R2 is
private, that IAM is least privilege or that a provider contract passed. Those are
separate gates. Changing the signer, credential, target, role or receipt requires
fresh approval. Every storage I/O rereads/verifies the receipt; an existing client
rejects a changed/removed/expired receipt. Renewal requires opening a fresh context
and generating a fresh recovery preview. No automatic renewal or cleanup scheduler
is installed. Key custody, rotation, revocation propagation and renewal availability
need owner-approved operating procedures.

Offline issuance is implemented by `npm --prefix giftlink-backend run images:r2:approve`.
Its inputs are `--output`, `--confirm-environment`, `--confirm-role`,
`--confirm-storage-target`, `--confirm-database-target`, and optional `--minutes`.
It reads the reviewed environment and `PHOTO_APPROVAL_PRIVATE_KEY` from secure
offline operator storage, compares confirmations, signs and exclusively creates a
private file. It performs **no network I/O**, never overwrites an existing file,
and reports only role/environment/expiry. Do not place the signing key in Vercel,
the API, a repository, shell arguments, chat or PR comments.

## Explicit runtime context and upload stop

`openR2PhotoContext` validates the signed config **before connection**, requires an
explicit remote opt-in when applicable, then uses the existing guarded database
target parser and read-only topology/fingerprint inspection. It requires a native
transaction-capable deployment and verifies all compatible legacy/photo indexes.
Its separate DB client bounds the pool to ten sockets, two concurrent connection
creations, a two-second pool wait and five-second selection/connect/socket limits.
These are per-instance bounds, not a fleet/Atlas capacity guarantee. It never
creates indexes, collections, sentinel objects, accounts or buckets.

`createR2ItemImagePipeline(context)` accepts only this sealed runtime-role context.
`createApp` must receive the exact `context.applicationConnectToDatabase` function,
the matching metadata config and that pipeline; a mismatched app connection fails
construction. Photo metadata, quota mutations and bytes use the separately guarded
connection, rechecking receipt and DB identity. Each context storage operation is
also DB-fenced. Auth/text use the pinned application connection, so invalid photo
authority does not block `/api/me` or release charges. These factories are tested
through real Express HTTP requests; ordinary startup does not invoke them.

New uploads default **off** in R2 config. Read-only R2 transport refuses PUT;
runtime transport always refuses DELETE; recovery transport always refuses PUT.
For a context explicitly configured to admit uploads, the code-only
`pipeline.setUploadAdmission(false)` stops new reservations and claims while
keeping authorized reads, status, ordering, logical deletion and recovery available.
Capabilities accurately report binary upload false / image read true. Already
claimed work drains under existing bounds; the next batch file cannot claim.
Resuming is allowed only within the original configured admission ceiling.

There is no public pause/admin endpoint. This control is **per process**, not a
multi-instance kill switch. A future fleet stop must deploy reviewed compatible
configuration/control to every instance, preserve status/read/cleanup where safe,
and account for bounded in-flight work. Signed authority revocation is different
from an admission pause: revoked authority denies photo I/O and keeps uncertain
charges; it cannot promise that already downloaded pixels disappear.

## Production-compatible operator recovery path

`npm --prefix giftlink-backend run images:r2:reconcile` is a separate entry; the
existing `images:reconcile` stays local-receipt-only. It loads no `.env` defaults.
Do **not** execute it against real resources in F1.

Both operations require explicit `--allow-remote`, `--approval-receipt`, `--database`,
`--environment`, `--provider r2-private`, `--bucket`, `--namespace` and `--manifest`.
The signed receipt must have the recovery role and match those targets before any
connection. Production and staging approvals cannot be reused across environments.

1. `--dry-run` uses only DB snapshot reads, topology/index checks and exact bounded
   object GETs. It exclusively writes a private local manifest, not provider data.
   `--after` / `--limit` are bounded as in B4. Output contains allowlisted fingerprints,
   categories, counts and manifest digest, not object keys, hashes, account IDs,
   connection strings, credentials or provider bodies. The private manifest holds
   row IDs/digests and stays off GitHub/chat. No repair-on-read occurs.
2. `--apply` is always a separate explicit invocation. It requires every
   `--confirm-database`, `--confirm-environment`, `--confirm-database-target`,
   `--confirm-storage-target`, `--confirm-provider`, `--confirm-bucket`,
   `--confirm-namespace` and `--confirm-manifest`. Wrong confirmations fail offline.
   The whole manifest/receipt/target/version/time/ledger batch is revalidated before
   mutation, followed by fenced leases and B4's exact-key compensation algorithm.
3. A crash/lost DELETE leaves durable `delete_unknown`, lease and charges. Read a
   **fresh** preview after lease/backoff eligibility; never replay an old manifest.
   Unknown absent PUTs remain unresolved regardless of age. No force refund,
   namespace scan, broad deletion or counter reset exists. Exit 2 means unresolved
   results, not successful cleanup; exit 1 means refusal/error/budget.

Receipts are included in the manifest target digest: renewal invalidates an old
manifest. Changed topology or credentials also requires fresh approved identity.
Mixed bindings/corrupt records make a preview fail closed, not skip to a global
fallback. Old local records need their original verified local context; future
storage migration would be separately designed and approved.

## Actual isolated evidence and reproducibility

Use Node 22 and the existing verified Docker fixtures:

```sh
npm --prefix giftlink-backend run lint
npm --prefix giftlink-backend run test:storage:r2
npm --prefix giftlink-backend test
CI=true TZ=America/Los_Angeles npm --prefix giftlink-frontend test -- --watchAll=false --runInBand
CI=true REACT_APP_BACKEND_URL='' npm --prefix giftlink-frontend run build
npm --prefix e2e run test:policy
npm --prefix e2e test
```

`r2Environment` generates synthetic account/credential/key/approval data; no live
configuration or credential lookup is involved. `seaweedR2Bridge` asserts the R2
wire host, HTTPS protocol, `auto` signing scope, exact bucket and namespace, then
re-signs/maps the request **only** into the live receipt-verified loopback fixture's
namespace. The R2 suites also block all actual HTTPS and nonloopback HTTP attempts
at the native HTTP boundary. Actual private SeaweedFS performs conditional/concurrent PUT, GET, HEAD
and DELETE; actual MongoDB transactions and Sharp processing are used.

**This bridge does not test Cloudflare TLS, credential acceptance, IAM, region,
namespace policy, jurisdiction, R2 errors/consistency or Vercel networking.** It is
a test-only code seam, not an endpoint override or deployed feature. No handler
override is accepted from an environment variable or CLI flag.

The 54 new cases cover target/config/startup refusal, signed authority, credential
and role separation, actual conditional races, admission/drain, stale revisions,
cross-account denial, lost/absent unknown PUTs, lost DELETE recovery, concurrent
manifests, receipt revocation, wrong DB, missing indexes without DDL, strict CLI
confirmations, corrupt media, session expiry and disabled rollback. All previous
local storage, cleanup/crash, C1/C2/D1/D2 and public/pickup tests are retained.
Final local totals and immutable CI evidence are recorded in the PR. No frontend
code or new visual design is included; [E1 screenshots](milestone-6.5e1-photo-acceptance.md#actual-visual-evidence)
remain the visual baseline, with the full isolated browser suite rerun in F1.

## Remaining rollout issues

| Priority | Still required before production photos |
| --- | --- |
| **P0** | Separate owner approval for exact private R2/Atlas/Vercel test resources and operations. No live credentials, bucket, provider API or remote database was accessed here. |
| **P0** | Real R2 signed TLS requests, actual role/prefix policy and bucket privacy, conditional writes/concurrency, checksum/metadata/error/absence semantics, missing bucket vs missing key and late/unknown mutations. Local compatibility cannot approve them. |
| **P0** | Reviewed hosted context wiring/flag transition, exact same-origin auth/CSRF/protection, Node/Sharp packaging, cold starts, body/memory/CPU/deadline limits and bounded hosted two-account E2E. Normal startup deliberately still refuses R2. |
| **P0** | Guarded remote index preview/apply approval, durable Atlas access/least privilege and coordinated DB/object/ledger restore drill with measured RPO/RTO. No automatic DDL or DB-only restore assumption. |
| **P1** | Offline Ed25519 custody/renewal/revocation and secure receipt delivery across instances; per-process admission is not fleet control. Production command/credential custody and time synchronization need an owner runbook. |
| **P1** | No automatic cleanup scheduler/monitoring. Unknown holds, retry exhaustion, 1,000 lifetime operation records, 100 MiB account limit, retention/erasure/support policy and incident ownership remain from E1. |
| **P1** | Each warm storage client retains at most 256 distinct attempted PUT keys (at most 128 normal two-variant photos; failures can consume the budget sooner). There is no eviction or automatic client rotation. Approve a bounded client/process lifecycle that drains in-flight work and preserves durable permits before activation; never clear ledger/unknown records to recover capacity. |
| **P1** | Extra receipt checks/topology reads add overhead; no-store delivery remains expensive. Representative query plans, throughput, Hobby eligibility/limits and total R2/Vercel/Atlas/backup costs remain unverified. |
| **P1** | E1 dependency advisories and Windows Docker Desktop/ACLs, physical Safari/iOS and low-memory mobile acceptance remain unresolved. F1 makes no dependency upgrade or device certification. |

Use the [separate production-readiness checklist](photo-production-readiness-checklist.md).
F1 is implementation plus isolated evidence, not a completed penetration test or
real-provider certification. No new provider compatibility finding is manufactured
from a passing bridge test.

## Rollback and failure procedure

For this disabled rollout, reverting F1 needs no schema/data migration: ordinary
text-only startup remains supported. Keep all photo flags false and verify existing
auth/browsing/inventory/pickup CI. None of the 16 original gifts changed.

After a future separately approved R2 trial: stop new admission through reviewed
compatible fleet configuration, let bounded claimed work drain where safe, and
retain the F1/B4-compatible recovery binary, approval files, bindings, journals and
tombstones. A total photo shutdown may be required; do not call it cleanup success.
Do not point the local CLI at R2, change prefixes to find old data, roll back to B2/B3
ledger behavior, drop indexes, restore deleted media as Ready, force-refund, reset
counters, replay uncertain PUTs or run broad object sweeps. Revalidate exact target
and a fresh signed preview before every operator apply. No such remote rollback
or cleanup was executed in F1.
