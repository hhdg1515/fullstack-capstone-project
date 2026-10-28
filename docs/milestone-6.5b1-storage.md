# Milestone 6.5B1 — Private storage and disposable SeaweedFS

The owner approved replacing MinIO **only for isolated local development and CI**.
Future production remains **private Cloudflare R2**. B1 started at `4826a1b` on
`codex/m65b1-private-storage`, based on main `4dbf600` (merged #59).

**B1 acceptance requires passing native contracts and GitHub CI at the reviewed
commit.** Local adapter and native contracts are implemented; the Draft PR must
remain Draft pending all evidence.
The [artifact/security/provenance review](milestone-6.5b1-seaweedfs-review.md)
records the exact approved test profile, dependency findings and provider differences.
MinIO Community remains banned; the original refusal tests remain intact.

No image routes, item/image schemas, MongoDB indexes, quotas, processing, photo UI
or public image delivery are added. B2/B3/B4 are not started. The application does
not import this adapter and behaves identically with media disabled. See the
[architecture](milestone-6.5-photo-architecture.md),
[security/lifecycle](milestone-6.5-security-and-lifecycle.md) and
[roadmap](milestone-6.5-implementation-roadmap.md).

## Run local storage checks

Use Node 22 and a local Docker engine running Linux/amd64 containers. From
`giftlink-backend`, in a shell or PowerShell:

```sh
npm ci
npm run test:storage:unit
npm run test:storage:seaweedfs
npm run test:storage
```

- `test:storage:unit`: all **49 original** non-network SDK/configuration/refusal tests.
- `test:storage:seaweedfs`: **14 real Docker S3 contracts**, including concurrent
  conditional writes, private reads, metadata, loss of a committed PUT response,
  identity substitution and actual resource cleanup.
- `test:storage`: both suites. Normal recursive `npm test` also runs both; no
  missing-Docker/artifact test is silently skipped in CI.

No environment file, cloud credential, bucket setup or remote database is needed.
The helper pulls only its reviewed digest if absent, generates its own credentials
and target configuration, and removes its owned resources in `finally`. The first
volume assignment takes longer than an empty-bucket readiness check; a bounded,
non-replayed synthetic startup probe precedes the normal five-second adapter tests.
No application timeout was raised.

Only Linux/amd64 was exercised. Windows Docker Desktop's local engine pipe is
explicitly selected by the helper; physical Windows/macOS are not certified here.
ARM/non-Linux engines fail before provisioning rather than selecting another image.
Do not repoint tests at an existing service, remote Docker daemon, Atlas or R2.

## Adapter contract

[`item-image-storage.js`](../giftlink-backend/services/item-image-storage.js)
remains unchanged from the original B1 implementation. The pinned modular SDKs
remain AWS S3 **3.1158.0** and Smithy HTTP handler **4.13.0**; no new dependency
or unrelated lockfile update was needed for SeaweedFS.

It exposes only `putVariant`, `getVariant`, `headVariant`, `deleteVariant` and
`close`. There is no runtime bucket/ACL/list/presign/bulk-delete interface.

- Opaque namespace/image-ID/generation/variant keys; no original filename,
  personally identifying path, foreign prefix, query or traversal.
- Maximum 256 KiB thumbnail / 1 MiB display; expected and actual length/SHA-256
  checks, WebP Content-Type metadata, no-store and generic disposition. B1 uses
  synthetic bytes; valid-image decoding/sanitization belongs to B3.
- Conditional `If-None-Match: *`, Content-MD5 and application SHA-256 metadata;
  `maxAttempts: 1`. A finite client-lifetime attempt set blocks explicit PUT replay.
  **This is not the durable cross-instance ledger required in B2.**
- Five-second total operation budget, one-second connection timeout, eight active
  operations; bounded object and SDK-error response bodies, explicit client close.
- Mutation timeout/network failures are indeterminate. DELETE acknowledgment is
  not absence/quota-release authority. Bare HEAD 404 is unconfirmed; a verified
  missing GET does not settle an earlier unknown PUT. Never replay it to recover.
- Errors contain safe categories only, with no raw provider body, token, key,
  bucket, credential, signed URL or cause. No import/startup I/O.

## Fail-closed target and credential boundary

[`item-image-storage-config.js`](../giftlink-backend/services/item-image-storage-config.js)
retains the disabled default. Enabled local configuration now truthfully requires
`seaweedfs-local` / `test`, explicit `us-east-1`, literal loopback endpoint, and a
live verifier independent of MongoDB. `minio-local`, R2, arbitrary DNS/URLs and
inherited AWS endpoint/credential resolution are rejected.

Only the verified fixture supplies the following private configuration; do not
copy it into `.env`, frontend code, logs, screenshots or PR comments:

| Setting | Exact fixture rule |
| --- | --- |
| `ITEM_IMAGES_ENABLED` | Unset/`false` disables without loading the SDK; exact `true` enables only with a verified local binding |
| `ITEM_IMAGE_STORAGE_DRIVER` / `ITEM_IMAGE_STORAGE_ENVIRONMENT` | `seaweedfs-local` / `test` |
| `ITEM_IMAGE_S3_ENDPOINT` / `ITEM_IMAGE_S3_REGION` | Receipt `http://127.0.0.1:<port>` / `us-east-1` |
| `ITEM_IMAGE_S3_BUCKET` / `ITEM_IMAGE_NAMESPACE` | Fresh `moveout-test-<run>` / `item-images-test-<run>` |
| Access key / secret | Dedicated random test pair, matching the receipt's credential hash and actual container environment |
| `ITEM_IMAGE_STORAGE_TARGET` | Fingerprint of driver/environment/run/container/image/volume/endpoint/bucket/namespace |

The verifier checks the local daemon, exact pinned image/source/binary, resource
IDs/labels/nonces, volume, sole bridge member, credential hash, startup arguments,
resource bounds and loopback port before storage I/O. The adapter's own transport
also fences hostname, port, method, exact object path and operation query. Explicit
credentials/endpoint/region, non-proxy transport and one-attempt SDK configuration
prevent external endpoint, proxy, credential-chain or redirect fallback.

The native fixture alone creates a private bucket after verifying the empty,
owned service. Auto-create and non-empty bucket deletion are disabled. Other
services/administration interfaces are not published or enabled. Existing Docker
containers, volumes and development MongoDB data are never reused.

## Ownership and shutdown

Each fixture owns a random `moveout-seaweed-<run>` container, volume and network.
A private mode-0600 JSON ownership receipt is written to a newly created OS temp
directory; it contains identities/hashes, not S3 credentials. No receipt is
committed. Repeated close is safe; a copied/foreign confirmation is refused.

Cleanup closes every client, re-inspects and validates the exact identities,
removes the owned container, then its named volume and empty network, and finally
its receipt directory. It does not enumerate/delete bucket objects, run Docker
prune, adopt an old resource or remove anything solely by a name prefix.

If the process is killed or Docker/identity verification fails, automatic removal
may stop and leave the private receipt for review. Preserve that receipt; inspect
its exact IDs and nonce against Docker before any targeted operator cleanup.
There is no bulk recovery sweep or production cleanup job. Native contracts
verify successful removal and protect against wrong receipts/substituted resources.

## Verification boundary

Results, reviewed commit and available GitHub CI links are recorded in the PR.
The [review](milestone-6.5b1-seaweedfs-review.md) distinguishes native service
behavior, in-process fault injection, source expectations and untested R2/OS behavior.
Normal backend CI runs the actual Docker contracts rather than relying on mocks.
Frontend/build/policy/local HTTPS browsers, axe, lint, actionlint, whitespace,
links and all 16 byte-identical demo gifts remain regression requirements.

The owner-created [Draft PR #60](https://github.com/hhdg1515/fullstack-capstone-project/pull/60)
tracks this branch; normal PR CI runs the complete backend suite including native
storage contracts. Exact reviewed-head results and CI links belong in that PR.
Local success alone does not satisfy B1's definition of done. No merge, deployment,
hosted E2E, R2 call, remote database/index change or provider-security change is
performed by this slice.
