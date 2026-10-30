# Photo operations runbook — local exercises, future trial gate

F3 adds diagnosis, not hosted activation or a production administration console.
Run from the repository root with Node **22.x**. Commands below load no automatic
remote target; the new tools do not load `.env`. Never put credentials, signing
keys, receipts/manifests, object keys, filenames, pixels or personal data into
chat, CI artifacts, screenshots or support logs. Commands use placeholders, not
real provider identities. PowerShell needs its own environment-variable syntax.

## 1. Offline configuration preview

```sh
npm --prefix giftlink-backend ci
npm --prefix giftlink-backend run images:preflight -- --offline
```

This loads the local Sharp module, checks Node 22, strict boolean/metadata limits,
and (only for an explicitly configured R2 candidate) the existing authoritative R2
validator, exact target/credential/metadata bindings and private signed receipt.
It never constructs S3 clients, connects MongoDB, resolves hosts or calls providers.
`MONGO_URL`, live topology/indexes, IAM, bucket privacy and hosted packaging are
**not verified**. The database fingerprint is only the supplied signed expectation.
`configurationValid: true` means these offline checks pass; `hostedTrialReady` is
**always false**. Ordinary startup still refuses R2/pipeline activation.

Output is allowlisted categories, version facts, fingerprints and verified
role/environment/expiry, not arbitrary exception text or receipt contents. Missing
files, invalid verification keys, untrusted identity/signature, trusted expiration
and future issue times are distinguished. The private signing key must not be
present in this runtime/candidate environment, even during a diagnostic preview.
An expired receipt is not extended by the tool. Disabled R2 does not read its
credential/receipt files. Exit **0**: offline configuration valid; **1**: refusal or
invalid configuration. There is no remote/apply mode.

## 2. Automated disposable recovery drills

```sh
npm --prefix giftlink-backend run test:images:operations
npm --prefix giftlink-backend run test:images:recovery
npm --prefix giftlink-backend run test:capacity
```

These create and verify their own disposable MongoDB replica sets and pinned
SeaweedFS fixtures, use synthetic identities, then remove only receipt-owned
resources. The R2 protocol bridge authenticates synthetic requests and maps them
to the verified **local** fixture; it is not real R2. Nonloopback HTTP/provider
HTTPS is blocked in those architecture drills. The capacity stress uses a
synthetic wire service plus actual MongoDB/Sharp, not a provider benchmark.
Never substitute an existing development/Atlas database. Do not Docker-prune.

## 3. Optional manual local fixture inspection

The automated commands above require no manual provisioning. For a deliberate
operator exercise, open a Node REPL in `giftlink-backend` and keep it alive:

```js
const mongo = await require('./test/helpers/isolated-mongo').createIsolatedMongo();
const seaweed = await require('./test/helpers/isolated-seaweedfs').createIsolatedSeaweedFS();
const preparation = require('./util/prepare-database');
const localEnv = { MONGO_URL: mongo.mongoUrl, MONGO_DB_NAME: mongo.dbName, DB_ENVIRONMENT: 'development' };
const preview = await preparation.main({ argv: ['--dry-run'], env: localEnv });
```

Review the new empty database, loopback endpoint, topology, fingerprint, index
operations and zero conflicts. Only then explicitly execute the existing guarded
index preparation against **this disposable fixture**:

```js
await preparation.main({ argv: ['--apply', '--confirm-db', mongo.dbName,
  '--confirm-environment', 'development', '--confirm-target', preview.target.fingerprint], env: localEnv });
console.log(JSON.stringify({ mongoReceipt: mongo.receiptPath, storageReceipt: seaweed.receiptPath,
  database: mongo.dbName, bucket: seaweed.receipt.bucket, namespace: seaweed.receipt.namespace }));
```

The in-memory `localEnv` prevents `.env` fallback and contains only the generated
local MongoDB target. No seed runs. Keep the private receipt paths local. In a
second shell, substitute those exact identities:

```sh
npm --prefix giftlink-backend run images:operations -- --local \
  --mongo-receipt '<private Mongo receipt path>' \
  --storage-receipt '<private SeaweedFS receipt path>' \
  --database '<giftdb_test_run>' --environment development \
  --provider seaweedfs-local --bucket '<moveout-test-run>' \
  --namespace '<item-images-test-run>' --limit 25
```

Both independent ownership receipts/live identities are checked by the existing
local verifier. Required legacy/photo indexes are checked, never created here.
The summary reads the **oldest maintenance page**, 1–25 rows plus one lookahead,
using the existing due-work index, MongoDB time and a two-second query deadline;
the CLI has a 30-second lifetime. It reports counts for due/future work, leases,
unknown-write operations, unsettled rows, exhausted attempts and backoff, plus
`hasMore`. These are overlapping **page counts**, not global backlog totals,
account accounting, object presence, recovery eligibility or an absence proof.
Ready/tombstone rows with no maintenance work are outside the page. There is no
account scan, pagination auto-loop, object read/write, quota repair or apply mode.
Concurrent changes mean it is an observation, not a transactional release permit.
Use the actual recovery preview for ledger/ownership/object evidence.

Exit **0** means a valid local read-only page, even if it reports unresolved work;
**1** means refusal/budget failure, not an empty backlog. Missing/incompatible
indexes need a separately reviewed preparation; never bypass the receipt check.
This tool has no `--allow-remote`, R2 or staging/production support.

## 4. Separate preview and explicitly approved local cleanup

```sh
npm --prefix giftlink-backend run images:reconcile -- --dry-run \
  --mongo-receipt '<private Mongo receipt path>' --storage-receipt '<private SeaweedFS receipt path>' \
  --database '<giftdb_test_run>' --environment development --provider seaweedfs-local \
  --bucket '<moveout-test-run>' --namespace '<item-images-test-run>' \
  --limit 25 --manifest '<new private manifest path>'
```

Review the private manifest, exact versions/target/receipt digest, ten-minute
MongoDB-time lifetime and object observations. A summary is not an approval.
`unknown_write`, unexpected/corrupt objects, ownership/accounting conflicts,
wrong role/target, active leases, exhaustion or expired approval mean **stop**;
follow the decision matrix below. Preview never mutates the ledger or objects.
Only an explicitly approved eligible batch may use:

```sh
npm --prefix giftlink-backend run images:reconcile -- --apply \
  --mongo-receipt '<same private Mongo receipt path>' --storage-receipt '<same private SeaweedFS receipt path>' \
  --database '<same database>' --environment development --provider seaweedfs-local \
  --bucket '<same bucket>' --namespace '<same namespace>' --manifest '<reviewed manifest path>' \
  --confirm-database '<same database>' --confirm-environment development \
  --confirm-database-target '<full preview DB fingerprint>' --confirm-storage-target '<full preview storage fingerprint>' \
  --confirm-provider seaweedfs-local --confirm-bucket '<same bucket>' --confirm-namespace '<same namespace>' \
  --confirm-manifest '<full reviewed digest>'
```

Bounds remain 25 operations/100 inspections/120s, 60s leases, five cleanup claims.
Exit **0**: completed/no work; **2**: an entry remains unresolved; **1**:
configuration/refusal/changed/budget. Preserve partial state on every nonzero exit.
Do not wrap apply in a retry loop. Never replay an old manifest after interruption,
renewal or settlement. Obtain a fresh preview and explicit batch approval; do not
reset attempts, grant a lease or rewrite outcomes manually. No quota is refunded
until both variants have durable settled-writer/deletion evidence and verified
absence. Daily attempts/successes and lifetime operation rows stay consumed.

## 5. Stop, diagnose and continue

| Observation | Stop / preserve | Evidence needed to continue |
| --- | --- | --- |
| Wrong/missing target, role, receipt or credentials | No new client/claim; preserve all holds. Do not grant permissions as a workaround. | Independently verify intended identities and issue a separately approved exact binding. |
| Receipt expired/replaced/key rotated | Photo I/O fails closed; auth/text can remain available. Preserve possibly committed writes. | Valid new approval, restarted context, fresh recovery preview; no old manifest. |
| One API instance paused | Other instances may still admit. A pause is not revocation and claimed work may drain. | Inventory/stop each embedding instance; no hosted trial until an approved fleet procedure/control exists. |
| Unknown PUT + negative GET/timeout/worker death | Keep bytes/slot/concurrency/success credit/record. Never resend PUT or infer absence from time. | Positive exact byte evidence or separately approved provider-specific write-settlement evidence; current automatic recovery cannot resolve permanently absent unknowns. |
| Unknown PUT + matching bytes | Preserve identity and journal; do not mark Ready manually. | Fresh guarded compensation records settled-writer evidence before exact-key deletion. |
| Lost/interrupted DELETE | Keep `delete_unknown` and quota; do not broadly sweep objects. | Fresh preview, lease/backoff/fence checks, exact-key absence/deletion, then transactional settlement. |
| Metadata/object mismatch, damaged quota or ownership | No repair/refund/deletion; preserve evidence privately. | Focused reviewed investigation; restore is not a counter reset. |
| Active lease/backoff/exhaustion | Do not steal/reset authority. Time alone never settles a write. | Fresh server-time preview; exhausted work requires an owner decision. |
| 1,000 retained rows reached | Refuse new operations. Tombstones survive deletion. | Approved retention/account-erasure/capacity design; no ad hoc purge. |
| Worker/process restart | Old in-memory state proves nothing; durable charges survive. | Verify receipts and exact target; create new context and preview, never replay upload/manifest. |

The existing **trusted embedding handle**, not a shell command/admin endpoint,
can call `pipeline.setUploadAdmission(false)` per process. It stops new
reservations/claims, permits bounded claimed work to drain and retains separately
authorized reads/status/order/logical delete/recovery. Resume with
`pipeline.setUploadAdmission(true)` only when the original configuration allowed
uploads and the context/approval remains valid. There is no CLI to reach another
running process and no implemented fleet switch. Revoking authority instead blocks
photo reads/status/mutations too; communicate that stronger outage honestly.

For fixture shutdown in the owning REPL:

```js
await seaweed.close();
await mongo.close();
```

Helpers remove only their receipt-owned disposable resources. For real evidence,
preserve journals/receipts before any owner-authorized teardown. Destroying a test
fixture is not proof of physical deletion or settlement on a live provider.

## 6. Signed approval custody and lifecycle

Keep the Ed25519 PKCS8 private key in an owner-approved offline secret store,
separate from runtime and recovery credentials. APIs/workers receive only SPKI
verification public key and private receipt file; never bundle them into frontend
assets. Private JSON refuses Unix symlinks/foreign ownership/broad modes and is
size bounded. Parent-directory custody and backup protection still matter;
Windows ACL behavior needs physical verification. Do not generate live keys here.

After a **future separate approval**, offline issuance uses the existing command:

```sh
npm --prefix giftlink-backend run images:r2:approve -- \
  --output '<new private receipt file>' --minutes 60 \
  --confirm-environment staging --confirm-role '<runtime-or-recovery>' \
  --confirm-storage-target '<approved full storage fingerprint>' \
  --confirm-database-target '<approved full DB fingerprint>'
```

The signing environment contains only securely supplied reviewed inputs and the
offline private key; never pass it as a CLI argument, ask for it in chat or put it
in Vercel/GitHub runtime config. A distinct recovery identity cannot upload.
Default receipt lifetime is one hour, maximum 24 hours. Expiry uses the worker's
clock; maintain clock accuracy separately from MongoDB lease/server time.

Renewal creates a **new** private file/signature; issuance refuses overwrite.
Distribute it through an approved secure replacement/configuration process, stop
old instances, restart contexts and obtain a new manifest. Existing bindings pin
the original signature. Merely creating another file does not update old workers.
Key rotation likewise changes the approved verification key and receipt everywhere,
with old workers stopped; a newly configured worker refuses the old signer.

**No global or permanent revocation is implemented.** File removal/replacement
only affects workers that see it. Restoring an old, still-valid receipt to a worker
still trusting the old key can reauthorize that worker until expiry. Valid receipts
are reusable within their exact target/lifetime; the durable operation ledger,
not a one-time signature, prevents repeated PUTs. No trustworthy shared revocation
epoch/high-water mark exists. A future fleet design must address rollback and
in-flight operations before activation; see the readiness report and trial gates.

## 7. Rollback

F3 changes no runtime schema, index registry, quotas, storage core, cleanup
algorithm or production activation policy. Revert these diagnostic/test/docs/script
changes to return to F2; no data/index migration needs undoing. Keep B4/F1/F2-capable
recovery and all target bindings, generations, holds, leases and tombstones. Never
roll photo processing back to B2/B3 once B4 journals exist. Keep all production
photo flags false; disabled text/auth/inventory/pickup must remain usable. After
any future separately approved host rollback, get fresh target/receipt/ledger
evidence before continued cleanup. Coordinated restore requires its own drill,
not this code revert. No rollback command is executed by this milestone.
