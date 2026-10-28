# B1 — SeaweedFS local artifact and compatibility review

Reviewed 2026-10-27 (America/Los_Angeles). The owner approved **SeaweedFS only for
isolated, disposable local development and CI**, conditional on this review and
native contracts. **Private Cloudflare R2 remains the future production choice.**
MinIO Community remains banned; no AIStor, commercial service, unofficial image,
real R2 credential or provider configuration is used.

## Artifact, license and provenance

The official [latest release](https://github.com/seaweedfs/seaweedfs/releases/tag/4.51)
was **4.51**, published 2026-10-25. The project is actively maintained. Its
[README](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/README.md)
and [Docker guidance](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/docker/README.md)
identify `chrislusf/seaweedfs` as the publisher's container repository; this is not
an unofficial repackaging. The source and image labels specify
[Apache-2.0](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/LICENSE).
Redistribution must retain the applicable license/notices. No image is bundled
into the application or added to production startup.

| Reviewed identity | Pin |
| --- | --- |
| Official multi-architecture image index | `chrislusf/seaweedfs@sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8` |
| Tested Linux/amd64 manifest | `sha256:3a522c379599e163433a636e75022630848b63a74f08ea37bf06f8d776e9a707` |
| Tested amd64 image/config ID | `sha256:e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6` |
| Image's actual source commit | `ffa87c25fdf587178b1521ad87f2a4a72a02e584` |
| Actual source archive SHA-256 | `d650e7a8a2cbec8a1725386f87f5eb803c95aa84417530aec58c1925fd23a2c9` |
| Release tag's source commit | `153ab668c99731a6d29492bf6c61d0b4fa701101` |

**The tag and image sources differ.** BuildKit provenance and OCI labels show an
official October 26 rebuild from `ffa87c2`; do not claim the digest was built from
the October 25 tag `153ab66`. Both archives were inspected. License, go.mod,
mini configuration, S3 admin authentication, conditional PUT and routed-write
files were identical between these two revisions. The binary reports
`4.51 ffa87c25f linux amd64`. The fixture verifies full image/config ID, source
label and the binary's published abbreviated revision, never a mutable tag alone.

Cosign **3.1.4** verified the pinned index's signature, signing certificate chain,
OIDC issuer and bundled transparency-log claim. Verified signer:
`https://github.com/seaweedfs/seaweedfs/.github/workflows/container_release_unified.yml@refs/heads/master`,
issuer `https://token.actions.githubusercontent.com`, workflow commit `ffa87c2`.
The [official workflow](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/.github/workflows/container_release_unified.yml)
supports this manual release rebuild; an unrelated workflow/issuer was not accepted.

The default TUF CDN and Docker Hub index hostname were blocked by cloud policy.
Verification used the tool's supported explicit trusted-root input from
[Sigstore's own pinned source distribution](https://github.com/sigstore/root-signing/blob/b41c76a4f459c3256360209df8983dcf1acc98dd/targets/trusted_root.json)
(SHA-256 `6494e21ea73fa7ee769f85f57d5a3e6a08725eae1e38c755fc3517c9e6bc0b66`)
and Docker's canonical `registry-1.docker.io` hostname. No proxy was bypassed,
TLS disabled, or certificate/transparency verification skipped. Tool release
archives were checked against their publishers' release checksums. This is
review evidence at this pin, not a promise of future tag contents or trust-root freshness.

## Security findings and restricted acceptance

Trivy **0.76.1** scanned the actual pinned amd64 image (Alpine **3.24.3**, 29 OS
packages and Go binary) using vulnerability DB version 2, updated
2026-10-27 18:21 PDT. It reported **one HIGH and three UNKNOWN findings**, not zero:

| Finding | Installed / fix | Applicability to this fixture |
| --- | --- | --- |
| [CVE-2026-116587 / GHSA-mgcc-cww5-fp2q](https://github.com/go-jose/go-jose/security/advisories/GHSA-mgcc-cww5-fp2q), HIGH: unbounded RSA JWK validation CPU | go-jose/v4 4.1.5 / 4.1.6 | JWK/OIDC identity-provider intake is outside the enabled S3 SigV4 surface; embedded IAM is explicitly disabled and no provider configuration is loaded |
| [GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932), UNKNOWN: unsafe, unmaintained OpenPGP | x/crypto 0.58.0 / no fix | No PGP feature/input is enabled; not an S3 PUT/GET/HEAD/DELETE parser |
| [GO-2026-6860 / CVE-2026-78661](https://pkg.go.dev/vuln/GO-2026-6860), UNKNOWN: HTML parser quadratic work | x/net 0.61.0 / 0.62.0 | No webpage ingestion/UI pipeline is enabled; object bytes remain opaque S3 bodies |
| [GO-2026-6866 / CVE-2026-97045](https://pkg.go.dev/vuln/GO-2026-6866), UNKNOWN: HTML rendering namespace transitions | x/net 0.61.0 / 0.62.0 | Same disabled HTML-rendering surface; no application photo/display feature is implemented |

All 25 entries on the publisher's three
[security-advisory pages](https://github.com/seaweedfs/seaweedfs/security/advisories)
were inspected. Their published affected-version ranges end at 4.45 or earlier;
many still say no patched version. **That alone is not evidence of a fix.**
For example, the actual reviewed source's
[`checkAdminAuth`](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/weed/s3api/s3api_server_grpc.go)
now guards identity/policy mutations, addressing the missing-authentication path
in [GHSA-5fx4-c9qp-36jc](https://github.com/seaweedfs/seaweedfs/security/advisories/GHSA-5fx4-c9qp-36jc).
Other reviewed recent advisories cover SFTP, cloud fetch/SSRF, Lance, ArangoDB
and form-POST bucket policies. Those components/operations are not enabled in
this fixture. No exhaustive reachability audit or exploit-free certification is claimed.

**Acceptance is limited to this synthetic, single-tenant test profile**, not a
waiver for general development servers or production:

- Only random per-run credentials and synthetic bytes; no external users, remote
  identities, provider configuration or real marketplace data.
- Non-root UID/GID 1000, all Linux capabilities dropped, no-new-privileges,
  read-only root filesystem, bounded writable tmpfs, 768 MiB / 2 CPUs / 256 PIDs.
- Exact reviewed startup arguments disable IAM, admin UI, WebDAV, Iceberg, Lance,
  automatic bucket creation and non-empty recursive bucket deletion. No SFTP,
  cloud provider, ArangoDB or external identity configuration is supplied.
- A dedicated single-container bridge disables IP masquerading and inter-container
  communication; the fixture verifies these settings and membership. Only S3 is
  published, on literal `127.0.0.1`. This is **not an air-gap or a sandbox against
  an administrator/untrusted user controlling the same Docker host**.
- Source/labels/credentials/arguments/resource limits and live target identities
  are checked before writes; the app adapter cannot select another endpoint.

Docker 28's `--internal` network did not publish the requested port during the
first smoke test. The dedicated non-masquerading bridge above is the supported
profile actually exercised; no host networking, public bind, firewall widening,
credential fallback or unverified proxy was introduced. The incomplete first
smoke resources were removed using an exact recorded ownership recovery receipt;
subsequent fixture teardown and receipt checks passed.

This judgment relies on disabled attack surfaces and disposable trusted tests.
Any additional service, untrusted exposure, platform or digest invalidates this
acceptance and requires review. Prefer a future upstream artifact fixing these
dependencies, with a separately reviewed pin; do not update it silently.

## Native S3 behavior and R2 boundary

The actual source reduces `If-None-Match: *` to `IF_NOT_EXISTS` in
[`buildWriteCondition`](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/weed/s3api/s3api_object_routed_write.go),
evaluated with the write on the filer ownership/locking path. Real contracts
exercise separate SDK/adapter instances: an existing key rejects replacement,
and three four-writer races each produce exactly one winner with unchanged bytes.
No client mutex was used to simulate that guarantee.

| Observed SeaweedFS behavior | Application / future R2 implication |
| --- | --- |
| Exact synthetic bytes, WebP Content-Type, no-store, generic disposition and SHA-256 user metadata round-trip | The B1 contract works; bytes are not decoded/validated as WebP until B3 |
| Private object rejects anonymous and wrong-secret reads with 403 | No public ACL or anonymous identity is installed; R2 bucket/token configuration still needs separate approval/testing |
| Existing conditional PUT returns 412; concurrent contenders reject without overwriting | Preserve the conditional header, one SDK attempt and future durable ledger; do not infer provider-independent crash semantics |
| Missing GET is NoSuchKey/404, missing HEAD is a bare 404, missing bucket GET is NoSuchBucket/404 | HEAD absence remains unconfirmed; error names/bodies must be tested on real R2 later, never assume every 404 means a missing object |
| Repeated DELETE acknowledges success; sibling keys remain intact | Acknowledgment is not quota-release authority or settlement of an earlier unknown PUT |
| Initial empty-bucket checks precede first volume assignment; early application PUTs hit the unchanged five-second cap | Fixture readiness performs one fresh, recorded, synthetic setup PUT (30-second maximum, no replay), then deletes it. Application limits remain five seconds; R2 does not share this local volume startup model |
| A real committed PUT whose response is deliberately lost remains readable afterward | Transport fault injection confirms indeterminate outcome and zero replay; it does not simulate a provider crash or certify R2 |
| SeaweedFS has bucket/identity administration APIs | Fixture-only bucket creation occurs after target/empty-server checks. Runtime exposes none; R2 does not share all SeaweedFS IAM/ACL semantics |

R2 was **not contacted**. These are observed SeaweedFS contracts versus the
[documented R2 design](milestone-6.5-photo-architecture.md), not live comparative
R2 results. Use path-style local addressing and explicit `us-east-1`; eventual
R2 uses its approved endpoint and `auto` region. Existing SDK checksum settings
remain `WHEN_REQUIRED`, with application SHA-256 and Content-MD5 on variants;
no ETag-as-hash, presigned URL, bucket listing or multipart-upload assumption is added.

Native Docker evidence covers **Linux/amd64**. The helper explicitly selects the
local Unix socket or Windows Docker Desktop engine pipe and refuses non-Linux/
non-amd64 daemons. Physical Windows 11/macOS, ARM, Safari/iOS and production R2
are not claimed verified. Native ARM support needs its own reviewed image/config
ID and contract evidence; there is no silent emulation or fallback image.
