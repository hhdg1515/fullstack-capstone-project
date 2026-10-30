# Distributed photo control — isolated local operator procedure

F4 is not production activation. These commands are **local simulation only**, not
a remote Atlas/R2 setup path. Use Node 22; keep production gates false. POSIX shell
examples require equivalent PowerShell syntax. Never publish signing keys, full
snapshots, approval files, receipts, manifests, URI, credentials or object data.
The independent control-owner private key belongs only in an offline operator
process; API/worker environments receive its public key, never the private key.

## Automated exercise

```sh
npm --prefix giftlink-backend run test:images:distributed
```

This owns disposable MongoDB replica-set and verified private SeaweedFS resources,
prepares application indexes through the existing guarded local commands, runs
independent OS workers and cleans up only receipt-owned resources. No seed,
provider request, remote environment or hosted E2E is involved. Do not prune Docker.

## 1. Obtain verified disposable fixtures and review schema

Follow the [existing manual local fixture procedure](photo-operations-runbook.md#3-optional-manual-local-fixture-inspection).
Keep its owner process alive and retain both private local receipt paths. Review
the ordinary `db:prepare` dry-run and explicitly approve its exact disposable
database/environment/fingerprint before preparing the existing photo indexes.
F4 does not add its control to mandatory ordinary startup/index preparation:
metadata-disabled deployed applications must not need a new remote schema.

For a manual F4 bridge exercise, independently prepare valid **synthetic** F1
runtime and recovery role approvals using the existing test fixture/approval
helpers. These must match the preview's complete synthetic target and different
role credentials; do not copy real R2 secrets or remove receipt validation. The
regression suite demonstrates the entire flow without manual key handling.
There is no new general-purpose production fixture/bootstrap command.

Provision an offline Ed25519 control-owner key under an approved local custody
method (different from both F1 approval keys). Configure only its SPKI-hex public
key as `ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY` in the operator/worker environment.
Do not use or request a live key for this exercise.

## 2. Read-only preview

```sh
npm --prefix giftlink-backend run images:control -- --local-fixture --dry-run \
  --mongo-receipt '<private local Mongo receipt>' \
  --storage-receipt '<private local SeaweedFS receipt>' \
  --database '<owned disposable database>' --bucket '<owned local bucket>' \
  --namespace '<owned local namespace>' --snapshot '<NEW private snapshot path>'
```

There is no URL, ambient `.env`, remote flag, fallback target or object I/O. The
existing local verifier checks live daemon/image/volume/network/endpoint/DB/index
identity. A synthetic `r2-private` identity is derived from that local fixture;
this does **not** inspect Cloudflare. Output contains only mode, target digest,
previous policy digest/`absent`, revision, initialization flag and intended schema.

Review **collection `photoControls`, native unique `_id_` only**, target, state and
conflicts. Preview creates no collection/index/document. Unexpected indexes are
refused, never repaired. Initial apply may explicitly create that collection and
native index via first insert; there is no other DDL, migration, TTL or scheduler.
Private output files are exclusive-create and mode 0600; use new paths each time.

## 3. Offline owner approval

In a separate trusted **offline** process only, inject the synthetic private key
as `PHOTO_CONTROL_OWNER_PRIVATE_KEY` (PKCS8 hex) and the independently expected
public key as `ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY`. Never place the private key
in an API env file/CLI argument, shell history, CI log or source. Use:

```sh
npm --prefix giftlink-backend run images:control:approve -- \
  --snapshot '<reviewed private snapshot>' --action initialize \
  --runtime-approval '<valid synthetic private F1 runtime approval>' \
  --runtime-key '<synthetic runtime verification public key>' \
  --recovery-approval '<valid synthetic private F1 recovery approval>' \
  --recovery-key '<synthetic recovery verification public key>' \
  --confirm-target '<full preview target digest>' --confirm-previous absent \
  --confirm-revision 1 --output '<NEW private signed change path>'
```

Initialization is **paused**. Later actions are `pause`, `resume`,
`revoke-runtime`, `revoke-recovery`, `revoke-all`, `rotate-runtime`,
`rotate-recovery`. Each needs a fresh preview, exact previous digest and next
revision. Rotation needs only the relevant `--runtime-*` or `--recovery-*` pair,
a fresh valid receipt with strictly later issue time and a different full digest;
pause/resume/revoke need neither pair. Resume cannot resurrect revoked authority.
A runtime rotation also pauses admission. No automatic receipt renewal occurs.

## 4. Explicit, bounded apply

Remove the private key from the online operator environment. Within the signed
ten-minute DB-time application window, review and apply the exact new digest:

```sh
npm --prefix giftlink-backend run images:control -- --local-fixture --apply \
  --mongo-receipt '<same private local Mongo receipt>' \
  --storage-receipt '<same private local SeaweedFS receipt>' \
  --database '<same disposable database>' --bucket '<same local bucket>' \
  --namespace '<same local namespace>' --change '<reviewed private signed change>' \
  --confirm-target '<full preview target digest>' \
  --confirm-previous '<full previous digest or absent>' \
  --confirm-change '<full offline-approved change digest>' --confirm-revision '<next revision>'
```

Exact identity, signature, predecessor, next revision and DB-time window are
checked again in a majority transaction, competing with all participating worker
fences. No implicit re-sign, rebase, retry of stale approval, repair, object write,
refund or deletion occurs. The CLI has a 30-second budget; queries/commits are
bounded, with at most three transaction attempts. On timeout/ambiguous apply,
**read a fresh snapshot** and compare the signed digest/revision. Do not blindly
replay. A committed policy may exist despite a lost CLI response.

Worker explicit-context settings additionally pin
`ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED=true`,
`ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY`, `ITEM_IMAGE_CONTROL_ID` and a positive
`ITEM_IMAGE_CONTROL_MIN_REVISION`. This is test/future reviewed context wiring,
**not permission to change ordinary startup refusal or production false flags**.
Controlled contexts require replica-set topology and compatible native control
index, and refuse missing/invalid state without DDL. All original F1 configuration,
receipts, role/credential binding and independent local bridge receipts are still
required. Local admission ceilings may further restrict shared resume.

## Stop, revocation and restore

Before any future adoption, quiesce all uncontrolled/old photo processes. Do not
assume merely adding the record fences old code. Pause stops new reservations and
claims; committed claims can drain under valid runtime authority. Runtime revoke
blocks further photo authority; separately valid recovery can continue. Revoke-all
also stops recovery. Already-authorized storage I/O may still commit; retain unknown
holds and use fresh separately approved B4 recovery, never an absence-based refund.

For receipt rotation/renewal, fresh signed control grant, contexts and manifests
are required. New role trust alone cannot replace the independent owner signature.
Control-owner root rotation/compromise and actual R2 token revocation need a
separate out-of-band owner procedure. This CLI does not manage provider credentials.

A DB restore is not revocation-safe by itself. Keep all photo workers stopped and
photo gates false. Reconcile objects, ledger, unknown writes, deletion tombstones
and sessions; independently approve a fresh trust/checkpoint inventory. In-memory
floors/configured minimum revisions do not provide an independent durable
high-water authority. Never claim permanent revocation across restored databases.
No automatic hosted remote-control preparation or restore tool exists in F4.

For rollback retain F4-aware photo code after adoption. An older text-only binary
with gates off may preserve ordinary service, but must never be started as an
uncontrolled photo worker. Preserve all control/ledger records and exact target
binding. Shut down only the fixture resources referenced by your ownership receipts.
