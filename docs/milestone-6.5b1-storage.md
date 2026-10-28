# Milestone 6.5B1 — Private storage adapter and artifact gate

**Partial implementation; B1 is blocked, not complete.** Based on main
`4dbf600`, the merge of [#59](https://github.com/hhdg1515/fullstack-capstone-project/pull/59).
The [architecture](milestone-6.5-photo-architecture.md),
[security/lifecycle](milestone-6.5-security-and-lifecycle.md) and
[roadmap](milestone-6.5-implementation-roadmap.md) remain the future photo contract.
No photos, image routes, schemas, indexes, quotas, processing, UI or runtime
storage initialization are added here. The existing app does not import this
adapter. Do not proceed to B2 on the basis of synthetic transport tests.

## MinIO decision before provisioning

Reviewed 2026-10-27, America/Los_Angeles. **No acceptable local artifact was
established; no MinIO image was pulled, built or run.** The task explicitly says
to stop this portion if an acceptable artifact cannot be established.

- Official Community `master` resolves to
  `7aac2a2c5b7c882e68c1ce017d8256be2feea27f`. The repository is archived and
  its [README](https://github.com/minio/minio/blob/7aac2a2c5b7c882e68c1ce017d8256be2feea27f/README.md)
  says no longer maintained, source-only, with legacy binaries receiving no updates.
- Reviewed official [source archive](https://codeload.github.com/minio/minio/tar.gz/7aac2a2c5b7c882e68c1ce017d8256be2feea27f),
  SHA-256 `71794c2df26aad0cc99e8421c58b7aa2dd55969f979b0e7d1e931042e9fabcd6`.
  The [license](https://github.com/minio/minio/blob/7aac2a2c5b7c882e68c1ce017d8256be2feea27f/LICENSE)
  is AGPLv3, with audited source headers allowing version 3 or later; retain
  source/license and review obligations before distributing
  any future artifact. This PR does not distribute MinIO or a modified fork.
- [GHSA-hv4r-mvr4-25vw](https://github.com/minio/minio/security/advisories/GHSA-hv4r-mvr4-25vw)
  describes an unsigned-trailer signature bypass allowing object writes with a
  known valid access key and without its secret. The reviewed Community source
  still contains the identified conditional signature check in
  [`object-handlers.go`](https://github.com/minio/minio/blob/7aac2a2c5b7c882e68c1ce017d8256be2feea27f/cmd/object-handlers.go#L1899)
  and [`object-multipart-handlers.go`](https://github.com/minio/minio/blob/7aac2a2c5b7c882e68c1ce017d8256be2feea27f/cmd/object-multipart-handlers.go#L689).
  The advisory identifies an **AIStor** fixed release; it does not establish a
  patched Community artifact. Rebuilding the same source does not fix that path.
- The related [Snowball authentication bypass](https://github.com/minio/minio/security/advisories/GHSA-9c4q-hq6p-c237)
  also names AIStor as the upgrade path. The [ReadMultiple traversal advisory](https://github.com/minio/minio/security/advisories/GHSA-xh8f-g2qw-gcm7)
  affects distributed deployments; it explicitly excludes single-node standalone
  operation. No assertion is made that this is an exhaustive dependency/image scan.
- Local image inventory contained MongoDB, no MinIO artifact. Manifest inspection
  of the official `minio/minio:RELEASE.2025-09-07T16-13-09Z` candidate failed with
  registry authorization/manifest errors. No image digest could be verified;
  this older candidate also predates the 2026 signature advisories. This is not
  proof that every official image is unavailable everywhere.

Loopback exposure, random credentials and a pinned digest reduce risk but do not
repair signature verification. No `latest`, AIStor substitution, unofficial
mirror, silent source patch, proxy workaround or real R2 target is accepted.
The fixture helper always rejects with `artifact_unapproved`, before Docker,
credential lookup, volume/bucket creation or cleanup. No environment flag or
supplied receipt bypasses that gate.

**To unblock:** choose a specifically reviewed, licensed, patched MinIO Community
artifact/source revision (including dependency/image advisory evidence), or make
an explicit owner decision on a concrete alternative/risk proposal. Then review
a separate change implementing and verifying the fixture. No such approval,
source patch or vendor change is inferred here.

## Implemented adapter boundary

[`item-image-storage.js`](../giftlink-backend/services/item-image-storage.js)
uses exact locked `@aws-sdk/client-s3` **3.1158.0** and
`@smithy/node-http-handler` **4.13.0** (Apache-2.0; Node 22 compatible).
Only these direct dependencies and their locked transitive additions were added.

The adapter exposes `putVariant`, `getVariant`, `headVariant`, `deleteVariant`
and idempotent `close`. No bucket administration, ACL, presigning, list, bulk
delete, original filename or arbitrary target parameter exists. B1 treats bodies
as bounded synthetic bytes; actual WebP decoding/validation belongs to B3.

- Keys: `<fixture namespace>/<24 lowercase hex image ID>/<v4 generation UUID>/thumbnail.webp`
  or `display.webp`. No percent encoding, traversal, arbitrary suffix or foreign prefix.
- Maximum bytes: thumbnail 256 KiB, display 1 MiB. GET requires expected length
  and SHA-256, checks stored metadata and verifies actual bounded bytes. SDK
  error-body collection is also capped at 16 KiB. ETag is not a content hash.
- PUT sends Content-MD5, SHA-256 metadata, WebP Content-Type, `no-store`, a generic
  disposition and conditional `If-None-Match: *`. No public ACL is sent.
- All SDK operations have `maxAttempts: 1`; PUT is never automatically replayed.
  A bounded 256-key client-lifetime attempt set also refuses explicit reuse.
  This **does not provide durable/cross-instance idempotency**: the B2 ledger is
  still required. Never use a new client to recover an unknown PUT by replaying it.
- Five-second total operation budget, one-second connection timeout and at most
  eight active operations; busy calls are rejected, not queued. SDK clients and
  response streams are closed on completion/error/shutdown.
- Timeout/network failures on mutations are indeterminate. A successful DELETE
  means `delete_acknowledged`, not physical absence or permission to release a
  quota. A bare HEAD 404 is `unconfirmed_absence`; only explicit NoSuchKey/404
  establishes a missing exact object at that observation. It never settles an
  earlier unknown PUT that could complete later. NoSuchBucket is a target error;
  403 is authorization, never absence. Raw provider bodies/errors are discarded.

## Fail-closed configuration and future fixture contract

[`item-image-storage-config.js`](../giftlink-backend/services/item-image-storage-config.js)
defaults `ITEM_IMAGES_ENABLED` to false. Disabled construction loads no AWS SDK,
constructs no client and performs no credential or network lookup. This config
is deliberately separate from existing app/MongoDB configuration; nothing changes
normal startup, JSON/CSRF, authentication or database behavior.

The currently implemented enabled boundary permits **test / minio-local only**.
There is no R2 driver or remote activation switch. It requires an independently
verified fixture receipt **and a trusted live read-only verifier**, not merely
environment variables, a local MongoDB URL or a supplied receipt. Constructor
dependency injection is trusted server/test code, never request data.

| Setting | Enabled test rule; not a ready-to-use environment sample |
| --- | --- |
| `ITEM_IMAGES_ENABLED` | Exact `true`; unset/`false` disables, other values rejected |
| `ITEM_IMAGE_STORAGE_DRIVER` / `ITEM_IMAGE_STORAGE_ENVIRONMENT` | Exact `minio-local` / `test` |
| `ITEM_IMAGE_S3_ENDPOINT` / `ITEM_IMAGE_S3_REGION` | Exact receipt `http://127.0.0.1:<port>` / `us-east-1`; no DNS, credentials, path, query or remote URL |
| `ITEM_IMAGE_S3_BUCKET` / `ITEM_IMAGE_NAMESPACE` | Fresh `moveout-test-<run>` / `item-images-test-<run>` matching receipt |
| `ITEM_IMAGE_S3_ACCESS_KEY_ID` / `ITEM_IMAGE_S3_SECRET_ACCESS_KEY` | Random `test<16 hex>` / `<64 hex>` pair matching receipt credential hash; never default/inherited AWS credentials |
| `ITEM_IMAGE_STORAGE_TARGET` | SHA-256 of explicit provider/environment/run/container/image/volume/endpoint/bucket/namespace binding |

The adapter snapshots the binding and re-verifies the live target before every
operation. Its transport additionally fences exact loopback host/port, method,
object path and operation query. Explicit SDK credentials/region/endpoint and a
non-proxy agent prevent AWS/default endpoint resolution or environment proxy
fallback. Redirects are not followed. Public config serialization excludes secrets.
There is no target discovery or implicit bucket creation.

**Not implemented/verified:** a verifier backed by real Docker resources,
provisioning, receipt issuance, private bucket creation, actual MinIO contract or
cleanup. The synthetic test verifier grants authority only to an in-process
transport that never opens a socket. It must not be copied into runtime code.
When unblocked, require exact local daemon/container/image/volume/port identity,
loopback-only exposure, fresh randomized credentials, private bucket verification
before writes, receipt-owned teardown and no reuse/prune/foreign deletion. Test
Linux CI and Docker Desktop Linux-container mode separately; Windows/macOS are
not certified by the current Linux unit tests.

## Checks and operational use

From `giftlink-backend` on Node 22:

```sh
npm ci
npm run test:storage
npm run test:storage:minio
```

`test:storage` runs non-network configuration/SDK-protocol/failure tests and is
included in normal recursive `npm test`. `test:storage:minio` intentionally
**exits 1** with the categorized artifact blocker; it does not skip or report a
successful compatibility test. Do not hide this failure or mark B1 complete from
normal green regression CI. No cleanup command is needed because this PR creates
no MinIO resources, and it provides no deletion command for existing resources.

Run existing backend lint/integration, frontend tests/strict build, policy tests,
isolated local HTTPS browsers/axe, actionlint, whitespace and documentation-link
checks. Exact reviewed-commit results and available CI links belong in the PR.
Existing owned disposable MongoDB resources are confined to those unchanged
regression harnesses; the pre-existing development container is not touched.
All 16 demo gifts remain byte-identical. No hosted E2E, R2/provider call, deployment,
remote database/index change, upload feature or merge is authorized by this slice.

### Recorded local verification

Node **22.23.4**, Linux, existing owned MongoDB replica-set harness and system
Chromium. Final code was checked with the following results; these are local
results, not claims of GitHub CI or MinIO compatibility:

| Check | Result |
| --- | --- |
| Backend lint and complete recursive suite | 352 passing, including 49 new storage/config/gate tests |
| Frontend | 17 suites, 322 tests passing |
| Strict production build | Passed with `CI=true`, empty backend URL |
| Deployment/E2E policy | 56 passed, zero failed/skipped |
| Isolated local HTTPS browser suite | 36/36 passed, desktop/mobile; 99 axe checkpoints with zero reported violations |
| actionlint | 1.7.12 passed; release archive checksum verified |
| Markdown relative targets/fences and whitespace | Passed |
| Demo integrity | 16 records byte-identical, SHA-256 `23f3868a6c90695b112c453f7d642354970f632a337d3b432f16ed5cef78cc04` |
| Native MinIO command | Exit 1, `artifact_unapproved` / `not_attempted`; provisioning and contracts blocked |

The pre-existing development MongoDB container/volumes are preserved. Regression
fixtures clean their own resources; no MinIO resources exist to clean. Dependency
audit reports five existing tooling findings (four high, one moderate); no new
SDK/Smithy advisory or changed existing lockfile package entry was found. No
unrelated dependency updates were made.

GitHub API requests are currently denied by the cloud network proxy (HTTP 403
CONNECT to `api.github.com`). Git fetch/push uses the allowed Git host. PR creation
and GitHub CI evidence must be completed after supported API access is restored
or the owner opens the prepared branch comparison. No CI URL is invented here.
