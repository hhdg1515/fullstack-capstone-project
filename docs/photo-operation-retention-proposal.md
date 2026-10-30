# Photo operation retention decision packet — no execution authority

F2 implements safe upload-client lifetime, **not metadata pruning**. This proposal
does not authorize a migration, TTL, archive resource, quota increase, provider
access or deletion. The current 1,000-row/account bound and all counters stay intact.

## Current invariants

An operation stores ownership/item/plan binding, upload idempotency identity,
generation, input intent, exact variants/outcomes, charges, producer/recovery
leases, tombstone/settlement and timestamps. B4 validates the strict schema and
recomputes account aggregates against the bounded retained rows. Deleting rows or
resetting `operationCount` breaks those proofs; it is not safe archival.

| State / evidence | Current allowed action | Proposed retention eligibility |
| --- | --- | --- |
| Ready | Authorized reads and explicit owner management | Keep full operational record while live. No age-based erasure. |
| Reserved/processing | Existing lease/maintenance rules | Lease expiry only permits review; it does not prove no delayed write. No pruning. |
| Failed/delete_pending, unknown PUT, unsettled charge, exhausted cleanup | Bounded guarded preview and approved recovery | Never automatically archive away recovery fields, delete, refund or reset. Escalate unresolved evidence. |
| Deleted, zero charges/slots, complete fenced recovery, exact variant absence proved | Retain tombstone and deduplication authority | Candidate for a future approved compaction design, subject to retention/legal/restore holds; age alone is insufficient. |
| Legal/security/backup-reconciliation hold or live worker/reference | Preserve evidence | Ineligible regardless of nominal age. |

## Concrete future design for review

1. Inventory counts/age by state with bounded read-only pages; identify unknown
   holds and capacity exhaustion without exporting private images, hashes, keys or
   account emails to logs. Do not scan/delete a namespace as a capacity shortcut.
2. Define a dual-schema compact **deny-replay receipt**, retaining enough owner/item/
   upload/generation/target identity, terminal decision, settlement proof reference
   and time to refuse old intents and prevent restored/deleted media becoming Ready.
   Decide which hashes/keys can be removed only after audited physical settlement;
   pseudonymous IDs are not automatically anonymous data.
3. Design exact bounded accounting over full rows plus compact receipts/approved
   aggregate segments. Specify indexes and unique/idempotency lookup behavior for
   legacy intents. Current B4/metadata validators must fail closed until they
   explicitly understand the new schema; no in-place ad hoc field removal.
4. Keep replay-denial authority after moving bulky historical evidence to any
   owner-approved encrypted archive. Define archive access/audit/deletion and cost
   before provisioning. A failed archive must retain the source; archive success
   alone cannot delete recovery-required information.
5. Define separate full-record, receipt and aggregate resource bounds. Do not
   decrement today's lifetime counter to gain silent unlimited capacity. Any quota
   or product-policy change requires explicit owner approval and a compatibility
   release. Test 999/1,000 boundaries, late retries, concurrent workers, rollback,
   cross-store restore and older clients before a guarded migration.
6. Execute only with explicit target fingerprints, bounded dry-run manifests,
   approvals, transaction/lease fences, audit and interruption recovery. No job is
   automatically scheduled by this proposal.

## Owner policy decisions required

- Retention purpose/duration for fully settled terminal evidence and private
  images/backups, jurisdiction/legal/security holds and a named policy owner.
  **No arbitrary 30/90/180-day period is selected here.**
- Minimum replay-denial lifetime, account/item deletion semantics, appeal/support
  needs and maximum compact-receipt/aggregate storage. Expired HTTP sessions or
  approval receipts do not expire operation identity.
- Coordinated DB/object/ledger backup RPO/RTO and restore ordering. Reapply deletion
  authority before public reads; DB-only restore must not resurrect images or
  phantom capacity. Backups may contain prior pixels and need an explicit policy.
- A support response at 1,000 rows and unresolved-write escalation. Never unblock
  an account by a manual counter reset, forged absence or unknown PUT replay.
- An account-erasure procedure: stop admission/revoke access, resolve references,
  unsettled objects/charges and holds, then minimize permitted identifiers through
  an approved audited path. Do not promise erasure while physical outcomes or
  mandatory retention remain unresolved. Removing the account first currently
  causes recovery accounting to fail closed; it is not an erasure implementation.
- Archive custody/location/cost and credential scope, if an archive is approved;
  no new paid resource or provider is assumed.

Approval must name the policy, compatibility/migration implementation, exact
resources and evidence. F2 leaves all operational metadata unchanged.
