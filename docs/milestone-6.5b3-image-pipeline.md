# 6.5B3 — Secure local processing and authorized delivery

Base: main `4f66c496ee1d57c5d4a3114e2dad6c4afa137101` (PR #61 merged).
Branch: `codex/m65b3-secure-image-pipeline`. The approved
[architecture](milestone-6.5-photo-architecture.md),
[security/lifecycle policy](milestone-6.5-security-and-lifecycle.md),
[B1 storage contract](milestone-6.5b1-storage.md) and
[B2 metadata/quota foundation](milestone-6.5b2-photo-metadata.md) still apply.

## Activation boundary

**Real user uploads and image delivery remain disabled until B4 is accepted.**
There is no photo UI, public bucket, direct-upload URL, worker, scheduler,
retention deletion, remote configuration or R2 implementation. Photos remain
optional. Existing no-photo items and all 16 demo gifts are unchanged.

`ITEM_IMAGE_PIPELINE_ENABLED` must be unset or exactly `false`. Every other value,
including `true`, fails configuration rather than enabling a deployed partial
pipeline. `ITEM_IMAGE_METADATA_ENABLED` retains the B2 behavior: unset/false needs
only the 12 pre-photo indexes; explicit metadata requires the four compatible photo
indexes. Explicit guarded preparation always covers all 16 definitions. Neither
startup nor a feature flag creates indexes or migrates data.

Local tests explicitly inject an opaque pipeline built with B1's live-verified
SeaweedFS configuration and matching metadata fingerprint/namespace/limits. An
arbitrary object, copied config, endpoint, raw credential or environment override
cannot substitute for that binding. No storage credentials are read from the
application environment by B3. B1 still refuses R2/MinIO/external fallback.
`binaryUploadsEnabled` remains false in owner DTOs as a product activation gate.

## Intake and resource envelope

Only enabled local fixtures register
`PUT /api/move-out-plans/:planId/items/:itemId/images/:imageId/content`.
The exact method/path is the sole multipart exception to the existing JSON write
policy. Exact Origin/CSRF remain mandatory everywhere. Session, canonical owner,
plan/item/operation, current eligibility and reservation checks precede parsing.
Canonical references must be native ObjectIds, not arrays that MongoDB equality
could otherwise match. No caller controls owner, key, fence or generation.

The constrained multipart reader accepts exactly one `file` part with filename
present but ignored, no fields/extra parts, at most 2 KiB part headers and a
1–70 character boundary. Browser MIME/extension is never format evidence; a
declared supported image MIME must agree with the sniffed bytes, and generic
octet-stream is supported. Unsupported encodings are rejected; identity only.

| Bound | Enforcement |
| --- | --- |
| Compressed file | Actual 1–3,145,728 bytes; exact reserved length and SHA-256 |
| Whole request | Actual 3,407,872 bytes maximum, including chunked bodies; Content-Length is only an early check |
| Intake | Real 10-second timer; malformed/truncated bodies fail and stop intake |
| Native admission | One active pipeline per warm process across app instances, no unbounded work queue; busy tickets stay unclaimed |
| Decoded input | 16,000,000 pixels, each axis ≤10,000, static 8-bit JPEG/PNG/WebP, 1–4 channels |
| PNG ancillary data | 64 KiB per chunk, at most 1 MiB total expanded metadata; bounded compressed metadata and IDAT inflation |
| Sharp | Concurrency 1, file/memory/item cache disabled, strict `failOn:warning`, sequential read, input pixel cap, native output timeout 5s |
| Outputs | WebP quality 80/effort 4, 400px thumbnail ≤256 KiB, 1280px display ≤1 MiB, no enlargement |
| Object calls | Unchanged B1 five-second operation budget, one SDK attempt per write |
| Reads | Eight admitted verified requests per process, each at most 1 MiB, no unbounded queue |
| Overall processing | Cooperative 40-second request budget plus persisted 120-second/UTC-boundary lease; not a hosted SLA |

Existing MongoDB driver transaction retry/commit uncertainty can outlive the
cooperative request target; callbacks contain no Sharp/storage I/O, and expired
fences cannot authorize subsequent content transitions. No JavaScript timer is
represented as a hard native-process sandbox or absolute RSS limit. Native
timeouts, pixel/byte caps and admission bound work; host memory/duration and
adapter behavior still require separately authorized hosted verification.
The documented Vercel request/response ceiling is 4.5 MB; the 3.25 MiB raw
multipart envelope and ≤1 MiB output leave nominal headroom. Actual adapter/proxy
buffering, payload representation, function memory/duration and native packaging
on the intended hosted project are unverified; no provider limit is inferred
from a successful local Express request.
The reviewed [Vercel Node handler](https://github.com/vercel/vercel/blob/84878e532142f0ac584953695658b324eb9e5b80/packages/node/src/serverless-functions/serverless-handler.mts)
calls `serializeBody` before forwarding requests to user code, while skipping API
helpers for Express listeners. This is a concrete upstream buffering risk: our
application admission cannot bound memory already allocated by that outer layer
or authenticate before provider intake. No installed hosted adapter version or
project concurrency setting was inferred from this source. Keep deployment
activation blocked until actual adapter buffering/concurrency is verified against
the memory and body envelope; local tests do not remove that gate.

## Formats and privacy

Before Sharp, bounded complete-container checks enforce PNG signature/chunk
lengths/CRC/order/static flags, exact consumed zlib stream/scanline bounds (also
Adam7), JPEG marker/scan/terminal boundaries, and RIFF/WebP chunk lengths/padding,
dimensions/static flags. Unknown critical/unsupported chunks and detectable
trailers/concatenations fail closed. PNG depth 16, APNG, animated WebP, SVG, GIF,
HTML, PDF, TIFF, HEIF/HEIC/AVIF and executables never reach native decoding.
Unsupported raster subtypes are rejected rather than relaxed to accommodate the
decoder. These checks do **not** prove detection of every possible polyglot.

Sharp applies all eight EXIF orientations (including mirrored forms), converts to
sRGB and encodes fresh WebP without copying EXIF/GPS/XMP/IPTC/ICC/comments.
Both actual outputs are inspected for metadata absence and exact dimensions,
sizes/type; the server computes their hashes. Tests verify real GPS/ICC source
metadata, independent expected pixel positions for all orientations, genuine
XMP/IPTC/comment inputs, and both resulting output files.

Original bytes exist only in bounded request memory. No originals, filenames or
source metadata are written to a file, MongoDB, object storage, Git or logs. The
input buffer is cleared after processing/finally. Only sanitized variants can be
stored. Metadata removal does not remove visible addresses, people or documents;
no visual-redaction guarantee is made.

## Durable claim, journal and finalization

Owner inspection returns canonical state for duplicates without decoding again.
One native slot is acquired before a reservation is claimed. A short native
plan transaction changes `reserved` to `processing` once, with a stable server
fence. Independent services racing on one operation produce one claimant.

B2's version-1 variant journal adds **`prepared`**: sanitized intent (immutable
key, dimensions, hash, bytes) exists, but no PUT permit has been issued. Before
each PUT, a fenced transaction changes only that variant to **`unknown`**. This
durable transition precedes I/O. No second claimant/duplicate may decode or PUT
the same operation, even through another adapter instance. Unknown outcomes are
never replayed. Storage and native processing always occur outside transaction
callbacks; tests inspect real session state during S3 calls.

Each conditional PUT uses the unchanged B1 adapter. A bounded GET verifies the
actual stored bytes/hash against the sanitized output before marking that variant
stored. Both stored variants are required before the final transaction. It
rechecks live ownership, plan/item eligibility, deadline/UTC lease and processing
fence, appends to the current ready order, increments imageRevision once and
atomically converts reserved bytes/held-success/concurrency to actual retained
bytes and a daily success. Text/status versions remain independent. The final
row CAS checks the lease against MongoDB `$$NOW`, not browser/Node time.

Owner deletion, clearance, plan closure, expiry and incompatible references fence
finalization. A lost final HTTP response can be recovered from the same canonical
operation; a MongoDB transaction retry never repeats storage writes. Already
ready replay is 200, processing replay is 202, closed/failed tickets return their
safe status with 409. No 202 claims upload completion.

Only a failure whose complete journal proves **no PUT was attempted** can release
byte/success/concurrency/slot holds. Attempts and retained operation records stay
consumed. Partial/unknown/stored-but-unfinalized failures retain the conservative
reservation and durable cleanup-needed evidence. If recording failure itself is
unavailable, the processing row/lease/intents remain for B4. A negative HEAD never
refunds capacity. No physical DELETE, compensation sweep or retention policy is
implemented in B3.

## Authorized GET and HEAD

`GET/HEAD /api/item-images/:imageId/:variant` accepts only `thumbnail` or `display`.
Ready state, both verified variant records, immutable keys/binding, native
references and an existing account/item/plan are required. Owners can read valid
retained photos on draft/hidden/expired/cleared items and inactive plans. Everyone
else follows the **same public-detail eligibility pipeline** as existing listings,
including reserved listings that remain publicly detailed. Old request/message
participation grants no additional access.

Authorization uses a consistent short snapshot, then storage I/O outside it,
then fresh authorization and session validation immediately before response.
Withdrawal, deletion, account/session revocation or changed references during a
fetch prevent delivery. A revocation after the final check cannot retract an
already in-flight or previously downloaded/rendered copy.

GET validates actual bounded bytes and SHA-256 through B1. HEAD performs only a
bounded HEAD, comparing its size/hash metadata to the verified ready ledger; it
does not download a body or claim fresh actual-byte verification. Tampered or
missing objects fail closed with safe JSON errors. Caller headers/keys, provider
URLs, error bodies, cookies and storage headers are never forwarded.

Responses fix WebP MIME, exact length, `nosniff`, `private, no-store`, generic
inline filename, `no-referrer` and same-site resource policy. Existing exact-origin
credentialed CORS/session handling is retained. Intended hosting remains the
same-origin `/api` proxy; local separate-port same-site use retains explicit CORS.
There are no presigned URLs, redirects, public cache headers or public owner IDs.

## Sharp provenance, packaging and advisories

Reviewed 2026-10-28. Official latest [Sharp v0.35.5](https://github.com/lovell/sharp/releases/tag/v0.35.5)
was published 2026-09-27. Exact pin `sharp@0.35.5` supports Node ≥20.9; this work
runs Node 22.23.4. npm integrity/lockfile pins and verified registry signatures
cover the installed packages. `npm audit signatures` verified **373 signatures
and 32 attestations**; the Sharp SLSA statement identifies publisher repository
`lovell/sharp`, workflow `.github/workflows/ci.yml`, tag `v0.35.5`, source commit
`51a990faa26ade5586a4934ac9673c98d8893326`.

The five published Sharp advisories returned by the official GitHub API affect
older versions; the newest high-severity fix starts at 0.35.5
([GHSA-wq5f-xc86-pv6w](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)).
Production-only npm audit reported zero findings. The full audit retains five
existing tooling findings (four high, one moderate: JSHint/lodash/minimatch/
serialize-javascript/Mocha); no unrelated dependency upgrades are bundled here.
This does not certify every native library or host OS free of vulnerabilities.

The Linux/x64 addon is 0.35.5; the native bundle is
`@img/sharp-libvips-linux-x64@1.3.4`, libvips **8.18.7**, WebP **1.6.0**,
libpng **1.6.58**, zlib-ng **2.3.3**. Other bundled loaders are not application
format support: their input signatures remain rejected. Sharp/addon license is
Apache-2.0; the native bundle declares LGPL-3.0-or-later, and colour is MIT. Retain
publisher notices, version/source/build references and applicable license material
when distributing native deployment artifacts. No native binary is committed.

Local `@vercel/nft@1.11.0` traced the backend entry and included the Linux addon
and libvips shared library. A separately copied traced artifact loaded Sharp and
processed actual PNG into WebP without the original node_modules. Trace warnings
cover absent optional MongoDB auth/compression modules, other platforms/development
Sharp modules, a dynamic optional lookup and attempting to parse the included ELF
as JavaScript; they are not silently claimed absent. The native artifact smoke
passed on Linux/x64. This is **not** a Vercel deployment/build or real adapter test.
Physical Windows/macOS/ARM, Safari/iOS and production runtime are unverified.

## Measured local resources and verification

`npm --prefix giftlink-backend run test:images:resources` generates synthetic
inputs in memory and pipes each to a fresh child for cold native/RSS attribution.
Children are benchmark processes, not production workers. The
[recorded measurements](verification/m65b3-resource-results.json) distinguish
require time, first processing, child wall time and peak RSS.

| Synthetic 16 MP case | Input bytes | Cold require | First processing | Peak RSS |
| --- | --- | --- | --- | --- |
| 4000×4000 RGBA PNG | 318,648 | 31 ms | 444 ms | 272 MiB |
| 4000×4000 noise JPEG | 2,070,331 | 35 ms | 360 ms | 115 MiB |
| 10000×1600 noise JPEG | 2,069,478 | 31 ms | 114 ms | 162 MiB |

All three were accepted within output caps. These samples exercise maximum
pixels/axis and a noisy input; they are observations, not an upper bound for all
hostile images or a hosted cold-start/latency guarantee. The native integration
suite also emits aggregate warm HTTP GET/HEAD timing, including Docker identity
verification overhead, without identifiers or private data. Real R2 latency,
network failures and platform memory/concurrency costs remain unmeasured.
One full local regression run measured GET **113 ms / 946 bytes** and metadata-only
HEAD **103 ms / zero body bytes**. This is a warm synthetic sample including the
live Docker verifier, not a provider/network latency forecast.

Run `npm --prefix giftlink-backend run test:images:pipeline` for the complete
new raster/privacy/native transaction/S3 suites. Normal `npm test` includes them,
all previous B1/B2/inventory/discovery/pickup/chat/rescheduling/preparation tests,
and unchanged real SeaweedFS contracts. Frontend/build/policy and full local HTTPS
browsers remain CI gates. Local photo browser fixtures explicitly refuse hosted
mode and test independent browser sessions, actual image loads and revocation;
they add no frontend upload UI or hosted synthetic-data budget.

Exact local/CI counts, immutable reviewed commit and CI URL are in the B3 PR.
No Atlas/R2 connection, remote index/data change, hosted E2E, provider-setting
change, deployment or merge is part of this work.

## Required next gates

B4 must implement and separately verify bounded physical deletion, compensation,
unknown-write settlement, crash recovery and operator reconciliation. Keep
ledger/charges/tombstones until outcomes are proven; never enable retention or
refund uncertain bytes because a key is temporarily absent. Before any real-user
activation, separately approve remote index preparation, R2 permissions/targets,
actual Vercel packaging/body buffering/function duration/memory behavior and
bounded hosted verification. No public-launch readiness is claimed by B3.
