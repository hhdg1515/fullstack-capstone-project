# Windows 11 local MVP acceptance

This creates **fresh disposable local resources on every run**. It never loads
`.env`, accepts a database/storage endpoint, contacts Atlas/R2, deploys or enables
hosted photos. Stopping deletes this run's synthetic data and photos. Existing
Docker resources are not reused or pruned. Do not use real personal information.

## Prerequisites

Windows 11 x64, PowerShell, Git for Windows (includes OpenSSL), Node.js **22.x**,
npm, Docker Desktop using **Linux x64 containers**, and Edge or Chrome. No WSL
commands are needed. First-time npm installation and pinned container pulls need registry internet access; application data services stay local. Docker Desktop's own virtualization backend may use WSL2
or Hyper-V; application commands run in Windows PowerShell. ARM64 is not a
verified fixture target. Allow space for MongoDB, SeaweedFS and dependencies.

In Docker Desktop start the engine, select Linux containers and confirm:

```powershell
node --version
npm --version
docker version
docker info --format '{{.OSType}} {{.Architecture}}'
```

Expected Node major 22; Docker `linux x86_64`/`linux amd64`. The verified image
digests and identities remain in `test/helpers/isolated-mongo.js` and
`test/fixtures/seaweedfs-artifact.json`. No substitute image is accepted.

## Clean checkout and startup

Use the reviewed C3 branch before merge, or main containing its merge afterward.
First inspect local work; never reset or discard it to follow this guide.

```powershell
Set-Location C:\path\to\fullstack-capstone-project
git status --short
git branch --show-current
npm --prefix giftlink-backend ci
npm --prefix giftlink-frontend ci
npm --prefix e2e ci
Remove-Item Env:MONGO_URL -ErrorAction SilentlyContinue
Remove-Item Env:E2E_APP_ORIGIN -ErrorAction SilentlyContinue
Remove-Item Env:ITEM_IMAGE_STORAGE_ENDPOINT -ErrorAction SilentlyContinue
Remove-Item Env:ITEM_IMAGE_R2_ENABLED -ErrorAction SilentlyContinue
node local/manual-mvp.cjs --approve-disposable-local
```

Run in a dedicated terminal. The explicit flag approves provisioning and guarded
index preparation **only on fresh receipt-verified local fixtures**. The launcher:

1. Forces the local Docker socket/named pipe, removing remote Docker selectors.
2. Starts CRA's real development server on an unused loopback port.
3. Provisions MongoDB's disposable replica set and verifies process/container/
   image/database/volumes before index writes.
4. Invokes `util/prepare-database.js` first with `--dry-run`, then `--apply
   --confirm-db <fresh-database> --confirm-environment development
   --confirm-target <exact-preview-fingerprint>`. No seeds or account migration.
5. Provisions private SeaweedFS with dedicated random credentials and verified
   receipt, bucket and namespace; injects the existing Sharp pipeline locally.
6. Enables `OWNER_LISTINGS_ENABLED`, `OWNER_LISTING_PHOTOS_ENABLED`,
   `OWNER_LISTING_PICKUPS_ENABLED`, `OWNER_LISTING_PUBLICATION_ENABLED` and
   `ITEM_IMAGE_METADATA_ENABLED` only in the in-memory isolated app configuration.
   Hosted binary intake and R2 environment gates remain off.
7. Starts the backend and same-origin HTTPS gateway; prints an exact address
   such as `https://127.0.0.1:<assigned-port>/app/listings` and `/api/health`.

Open **the printed HTTPS address**, not CRA's underlying HTTP port. It supplies
same-origin Secure HttpOnly sessions and CSRF/Origin checks. No persistent secret
file or production `.env` edit is needed. Changes in React source are served by
the dev server; use browser Refresh (after saving drafts) if hot reload is absent.

The per-run self-signed certificate triggers a local browser warning. Verify the
URL is exactly `127.0.0.1` and use the browser's explicit local exception. The
launcher prints the public certificate path for inspection; do not distribute or
trust its private key. Never disable certificate validation globally. Browser
policy may forbid an exception: use an owner-approved local certificate trust
procedure or report the restriction. Automated Chromium ignores errors only in
its isolated test context; this does not prove Windows browser trust behavior.

## Two-account walkthrough

Use a normal browser session for Account A, and InPrivate/Incognito for Account B.
Register two different `@example.test` accounts with synthetic names and unique
local passwords. Registration is through the existing UI; no seeded passwords.

1. A: My Listings → Create Listing. Save a name-only private draft. Verify it is
   absent from anonymous Find Free Items.
2. Edit it: select an item type, enter description, State/Metro, future pickup
   deadline, choose and **explicitly confirm** the pickup timezone. Optional
   city, neighborhood and condition can remain empty.
3. Select two synthetic JPEG/PNG/WebP files. **Save draft with 2 photos** saves
   text first and then runs the secure sequential upload. Wait for confirmed
   thumbnails. Use Edit Listing → Make cover/Up/Down to set order. Save changes.
   HEIC decoding is unsupported; large supported files are browser-prepared.
4. Publish listing (or use Publish with N photos directly from a completed
   form). Publication and photo success are distinct: recover partial uploads
   in that item's context; never repeat an uncertain item POST or binary PUT.
5. B: anonymous Find Free Items → same region → listing → photo gallery.
   Sign in and request a future appointment in the **giver's confirmed zone**.
6. A: Incoming requests → accept. Both: open the request's conversation, send
   synthetic messages, propose and accept a formal time change. Chat text alone
   never changes the appointment.
7. At/after the real appointment, A records the legitimate handoff. Verify
   Completed/read-only history; the cleared item is absent from discovery and
   B cannot fetch new photo bytes. A retains authorized owner access.
8. A: create a second item in a different region. Publish; verify independent
   location/deadline. Withdraw it and explicitly confirm affected future
   request cancellation. Verify public detail/photos/new requests are denied,
   while original participants retain permitted read-only text history.
9. Test third-account denial, logout/login, Back/Forward and 320/375px reflow.
   Existing Move-out Plans remain available and unchanged.

Use photos without faces, residential addresses, EXIF-sensitive real subjects
or other private information. Do not point this fixture at real user data.

## Shutdown, reset and troubleshooting

Press **Ctrl+C in the launcher terminal**. It stops only its spawned CRA child
and app servers, then uses existing ownership receipts to remove its MongoDB and
SeaweedFS containers/volumes/network/bucket. This also resets accounts/listings/
photos. Start again with the same command for a fresh run. Do not run Docker
prune, delete all containers, or remove unrelated named volumes.

If the terminal/process is forcibly killed, automatic cleanup may be interrupted.
Do not guess ownership from names alone. Preserve the per-run temporary receipt
files and inspect the existing guarded local maintenance procedure before any
cleanup; stop if identity verification fails. There is no blanket cleanup command.

- **Node mismatch:** install Node 22 and reopen PowerShell.
- **OpenSSL missing:** install Git for Windows in its usual Program Files path
  or put its `usr\bin` directory on this terminal's PATH. Restart the command.
- **Docker unavailable:** start Docker Desktop in Linux-container mode. Remote
  Docker contexts are intentionally ignored. Never bypass image/receipt checks.
- **Startup/index error:** no remote fallback exists. Check available disk/RAM,
  Docker Linux x64 support and dependency installation. Retry with a fresh run;
  do not copy Atlas credentials into local configuration.
- **Session/CSRF/photo unavailable:** use the exact printed HTTPS origin in both
  browser sessions. Do not mix localhost, 127.0.0.1, HTTP or different run ports.
- **Photo failure:** keep the page open; use its status/recovery controls. Reload
  loses unsent in-memory files and is guarded. Ready photos survive a page reload
  during the same run; nothing survives fixture shutdown/reset.
- **No discovery results:** publish a complete listing and choose its correct
  metro; drafts, expired, withdrawn and reserved items are not available results.
- **Accepted appointment reached:** resolve it through request actions before
  withdrawal; the bulk withdrawal flow refuses to decide an ongoing handoff.

## Verification boundary

This guide is designed for native Windows PowerShell and Docker Desktop. This
C3 environment is Linux: Windows 11/PowerShell/Docker Desktop and physical
Safari/iOS execution remain **pending owner acceptance**. Linux execution and
static script checks must be recorded separately in the C3 acceptance report.
