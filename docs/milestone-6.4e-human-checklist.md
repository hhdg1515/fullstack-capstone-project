# Local human MVP acceptance checklist

Use synthetic household items and invented names only. This is a **local** trial,
not permission to test a hosted URL, prepare Atlas, remove Deployment Protection
or expose registration publicly. Record the checked commit (`git rev-parse HEAD`),
browser/device and any confusing step. The [acceptance report](milestone-6.4e-acceptance.md)
records known P2 feedback/form-width issues and unresolved launch gates.

## Start a fresh local application

Prerequisites: Node 22/npm, Docker and a supported browser. Commands use existing
README startup/index-preparation scripts. The example below adapts its new local
replica-set procedure to a **separate** manual-test name, volume, port and DB.
Do not reuse a real development database. If any chosen resource already exists
or port 27019/3060/3000 is occupied, stop and choose/review isolated names/ports;
do not remove or overwrite the existing resource.

1. From the repository root, install the locked dependencies:

   ```bash
   npm --prefix giftlink-backend ci
   npm --prefix giftlink-frontend ci
   ```

2. Confirm `moveout-mvp-manual` and `moveout-mvp-manual-data` are unused, then
   create a fresh local-only replica set. These commands are for the owner to
   run on their own machine; this milestone does not execute this manual setup.

   ```bash
   docker run --detach --name moveout-mvp-manual \
     --publish 127.0.0.1:27019:27017 \
     --mount source=moveout-mvp-manual-data,target=/data/db \
     mongo:8.0 --replSet giftlink-dev --bind_ip_all
   docker inspect --format '{{.Id}} {{.Name}} {{json .Mounts}} {{json .NetworkSettings.Ports}}' moveout-mvp-manual
   ```

   Verify the new container identity, only the fresh named data volume plus
   image-created disposable volumes, and loopback port 27019 → 27017. Then run
   the existing one-time replica-set initialization **only in that new container**:

   ```bash
   docker exec moveout-mvp-manual mongosh --quiet --eval 'rs.initiate({_id:"giftlink-dev",members:[{_id:0,host:"127.0.0.1:27017"}]})'
   docker exec moveout-mvp-manual mongosh --quiet --eval 'db.hello().isWritablePrimary'
   ```

   Wait for `true`; do not repeatedly initialize a running set. Keep the inspected
   container ID for eventual scoped cleanup.

3. In terminal A, select the disposable target explicitly; these process settings
   override ignored `.env` files. Preview before creating indexes:

   ```bash
   export MONGO_URL='mongodb://127.0.0.1:27019/?directConnection=true'
   export MONGO_DB_NAME=giftdb_mvp_manual
   export DB_ENVIRONMENT=development
   export NODE_ENV=development
   export APP_ORIGIN=http://localhost:3000
   export PORT=3060
   npm --prefix giftlink-backend run db:prepare -- --dry-run
   ```

   Verify local endpoint, database `giftdb_mvp_manual`, development environment,
   transaction-capable topology and no account/index conflicts against the new
   container. Stop on any mismatch. Copy **your local preview's full fingerprint**
   into the placeholder, then explicitly prepare only this disposable DB:

   ```bash
   npm --prefix giftlink-backend run db:prepare -- --apply \
     --confirm-db giftdb_mvp_manual \
     --confirm-environment development \
     --confirm-target '<full fingerprint from your local preview>'
   npm --prefix giftlink-backend start
   ```

   No demo seed, remote authorization flag or automatic migration is needed.

4. In terminal B, start the existing React development server:

   ```bash
   REACT_APP_BACKEND_URL=http://localhost:3060 npm --prefix giftlink-frontend start
   ```

   Open **http://localhost:3000** consistently; do not mix `localhost` and
   `127.0.0.1` browser/API origins. This manual development path uses HTTP dev
   cookies. The automated production-build harness below separately verifies
   local HTTPS/Secure HttpOnly cookies; neither certifies hosted settings.

For an automated reproduction, after installing backend/frontend/e2e dependencies
(`npm --prefix e2e ci`) and the existing Playwright Chromium prerequisites:

```bash
CI=true REACT_APP_BACKEND_URL= npm --prefix giftlink-frontend run build
npm --prefix e2e test -- mvp-acceptance.spec.cjs
```

Ensure `E2E_APP_ORIGIN` is **unset**, not a hosted destination. The acceptance
fixture refuses hosted configuration and provisions/removes its own verified
disposable replica set; it never uses the manual database. Full regression is
`npm --prefix e2e test`. Optional `MVP_ACCEPTANCE_EVIDENCE=1` on the acceptance
test refreshes the fixed repository screenshot/audit directory from local data;
normal CI does not regenerate committed evidence or enable traces/screenshots.

## Walk the journey in two independent sessions

Use **browser A = giver** and **browser B = requester**, for example a normal
window and a private window or two browser profiles. Two ordinary tabs in the
same profile are not independent sessions. Use distinct invented `.invalid`
emails and locally chosen unique passwords; do not post them or capture filled
credential forms. Use a deadline several days ahead and review the pickup IANA
timezone explicitly. No street address, GPS or tenancy information is required.

- [ ] **Anonymous B:** landing → Find Free Items → state and supported metro.
      Confirm a real empty state before A publishes; test Change region, Back,
      Forward and refresh. No account or geolocation permission is needed.
- [ ] **A:** Give Away → register, then logout/login. Confirm the intended
      destination survives login/registration and refreshed authentication.
- [ ] **A:** create a plan with city, neighborhood, supported metro, future
      deadline and reviewed timezone. Submit empty once; verify field focus and
      labels. Correct fields, cancel navigation and retain edits, then save/edit.
      Known UX-03: the generic red summary can persist until the next submit.
- [ ] **A:** save an item using only a name. Try Publish, see classification/
      description errors, complete and publish it. Publish a second distinct
      item, then save a third incomplete draft. Try repeated creation and confirm
      three inventory records, two Posted and one private Draft, with items first.
- [ ] **B:** select A's metro; find the two posted items, never the draft.
      Search, category → type, condition, pickup date/window and sort; clear
      optional filters while retaining the metro. Open a detail and return.
- [ ] **A:** view your own listing; verify Your listing and no self-request
      action. **B:** Request pickup → register/login → return to that request.
      Choose a future time in the giver's displayed timezone. Submit one request
      on each of the two items; find them under My pickup requests.
- [ ] **A:** Incoming requests → identify item, applicant and proposed time.
      Accept one; decline the other. Cancel a confirmation once and verify no
      change. Accepted means Reserved, not Picked Up; discovery count drops by
      one. **B:** sees correct Accepted/Declined status.
- [ ] **Both:** Open conversation on the accepted canonical request. Exchange
      synthetic multiline messages, manually Refresh to receive. Enter adds a
      newline; Send is explicit. Type an unsent draft, try to leave and cancel
      discard. Try a long unbroken string on mobile; history/composer must wrap.
- [ ] **A:** type “Let's meet at 3 PM” in chat. **Both:** verify the confirmed
      appointment has not changed. Propose a different future time formally.
      Confirm the old time stays visible and the proposer cannot self-approve.
      **B:** approve. Then reverse roles for a separate proposal and decline it;
      verify the confirmed time is unchanged by decline.
- [ ] **B:** open declined history, which is read-only. Request that still-
      available item again, then cancel the new request. It must have a distinct
      request reference; old history must stay closed.
- [ ] **A:** on this synthetic local fixture only, wait until the confirmed
      appointment passes, then simulate Confirm handoff. Do not change the OS
      clock, edit DB lifecycle fields, or perform this simulation on a real item.
      **Both:** Completed, readable message history, no Send/action reopening.
      **A:** inventory shows Picked Up for this recorded handoff, not merely
      acceptance. Manual Mark cleared, if tested separately, says Cleared.
- [ ] **Both:** logout and try a saved private URL; old private content must
      disappear and login be required. Re-login/refresh should recover permitted
      data; user A's private inventory must remain inaccessible to B.
- [ ] **Recovery:** stop only the local backend temporarily. Browse/reload and
      confirm an actionable service error rather than zero fake results or a raw
      JSON exception. Restart with terminal A's same verified settings, then Retry.
      After any uncertain write, refresh/review before a deliberate retry; never
      assume disconnect means it did not commit. Do not capture passwords/logs.

## Keyboard, mobile and sign-off

- [ ] At 1440/768/390/375/320 CSS pixels: inspect main navigation/menu, field
      labels, date/time inputs, filters, long content, wrapping cards and chat.
- [ ] Use keyboard only: visible focus, skip link, Menu/Escape/focus return,
      disclosure controls, first invalid field, confirmation cancellation and Send.
- [ ] Check real 200%/400% browser zoom, a screen reader and physical Safari/iOS
      keyboard/date controls where available. Record platform-specific failures;
      these checks were **not** certified by automated Chromium/axe.
- [ ] Note registration's narrower form/38px inputs/40px submit (UX-01), detail
      styling/refresh copy (UX-02) and stale validation summary (UX-03). Record
      whether they obstruct a real user; do not confuse them with failed writes.
- [ ] Record task outcome and confusing steps for each role, screenshots without
      credentials, severity and reproduction steps. No finding is resolved merely
      because a test is green.

Afterwards stop the two app servers. Remove only the verified manual container
and its dedicated volume after checking the saved ID and mounts again; do not
run prune, broad database drops or remove existing development resources.
Automated fixtures clean up their own containers separately. A local trial does
not authorize merging, hosted tests, Atlas changes or deployment. Public launch
still requires the owner decisions in the acceptance report.
