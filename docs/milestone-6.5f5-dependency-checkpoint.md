# F5 dependency checkpoint — explaining 67 versus 352

Evidence date: 2026-10-30 UTC. Node 22.23.4, npm 10.9.9, committed frontend
lock SHA256 `c6da1246b209cc15f841d62ba0def57369929e8ed4a0224a00ea122cbe2a53a6`.
No package, override, lockfile, framework or application dependency changed in F5.

## Reproduction and conclusion

| Run | Affected package entries | Severity: critical / high / moderate / low |
| --- | --- | --- |
| Committed F2 post-fix report | 67 | 0 / 27 / 18 / 22 |
| F4/F5 existing-cache audit | 352 | 0 / 71 / 165 / 116 |
| F5 existing-cache `--package-lock-only` | 352 | 0 / 71 / 165 / 116 |
| F5 independent fresh writable cache, same npm/registry/lock | 67 | 0 / 27 / 18 / 22 |

The **entire parsed fresh-cache report equals the committed F2 report**, including
metadata and every advisory record. The existing-cache report and lockfile-only
report also equal each other. All **122 package + numeric advisory-source pairs**
(102 unique GHSA URLs) are identical between F2 and 352: zero added, zero removed,
zero changed direct advisories. The extra **285 package entries are all inherited**
`via` links. Existing-cache reports have empty derived affected-range strings for
all 352 entries; the fresh report has none. Many reverse-dependency `effects`
expand in the existing-cache report.

This establishes a **cache-dependent npm derived/metavulnerability reporting
variation**, reproduced without dependency changes. It does not establish which
internal cache record or npm defect caused it, and this PR does not purge or
repair the shared cache. There is **no evidence of new registry advisory content
or changed application reachability behind this numerical increase**. F4's
registry/reporting explanation was a possibility, not a confirmed attribution;
F5 narrows it with independent-cache evidence. Neither count is a count of distinct
confirmed exploitable application vulnerabilities. The remaining 67 is nonzero
security debt, not a clean audit or a vulnerability waiver.

Reproduction from repository root (POSIX; audit exits 1 while findings remain):

```sh
npm --prefix giftlink-frontend audit --registry=https://registry.npmjs.org --json
npm --prefix giftlink-frontend audit --package-lock-only --registry=https://registry.npmjs.org --json
# Choose a NEW dedicated writable cache directory; do not clear anyone's cache.
npm --prefix giftlink-frontend audit --cache=/tmp/f5-audit-new-run --registry=https://registry.npmjs.org --json
```

Record cache condition, registry, npm version, lock hash, raw advisory IDs and
paths each time. Do not pick a cached count to claim a fix. Future advisory updates
can legitimately change any of these reports; the committed evidence is dated.
Backend full/runtime audits remain zero in the current fresh-cache check.

[Raw default-cache](verification/m65f5/frontend-default-cache.json),
[lock-only checksum/run metadata](verification/m65f5/frontend-lock-only.json),
[fresh-cache](verification/m65f5/frontend-fresh-cache.json), and
[derived advisory/path comparison](verification/m65f5/audit-comparison.json)
are public package metadata, with no credentials or private app data. The lock-only
raw output is byte-identical to the default-cache report; its hash is retained
instead of committing the duplicate. The offline
`node deployment/photo-audit-comparison.cjs` generator reads these snapshots,
committed locks and production source maps without network/install/fix operations.
It includes every affected installed node/version, one shortest dependency path,
GHSA/source IDs, changed report entries and new inherited entries. Paths include
peer/optional dependency edges, so a path is an installation/consumer explanation,
not proof of a live vulnerable execution. Three tests distinguish real advisory
addition from inherited count propagation and validate the captured reproduction.

## Reachability checkpoint and narrow follow-ups

There are **no frontend source or package changes since merged F2 #72**
`5806f5c1863bc2dd3f1469bc1eeb979670248057`. Fresh strict production source maps
again observe only `react-router` and `react-router-dom` among affected package
names. Other tools can emit generated vulnerable code, so source-map absence is
not nonreachability proof. CRA declares build/dev/test tools in `dependencies`;
`npm audit --omit=dev` cannot classify all of them as browser runtime.

| Boundary | Concrete advisory/path evidence | Current assessment and focused next review |
| --- | --- | --- |
| Browser navigation | `react-router-dom@6.30.6 → react-router@6.30.6`; **GHSA-wrjc-x8rr-h8h6** backslash open redirect, **GHSA-337j-9hxr-rhxg** SSR hydration constructor injection | Router modules are delivered. `authDestination` requires `/app/`, rejects backslashes/control characters; ordinary listing IDs construct internal paths. No confirmed attacker-controlled `Link`/`navigate` exploit is demonstrated. The app uses `createBrowserRouter` with a static catch-all, no SSR/hydration-data input. Prioritize a separate compatible router/backport and adversarial navigation review; do not claim the affected version fixed or universal safety. |
| Build minifier serialization | `react-scripts → css-minimizer-webpack-plugin → serialize-javascript@6.0.2`; **GHSA-5c6j-r48x-rmvq**, **GHSA-qj8w-gfj5-8c6v**, **GHSA-m5mm-p8h7-m29v** | Remaining copy differs from F2's repaired Terser consumers. Build options/functions/regex/source are trusted repository input; user photo/text payloads are not compiled here. Propose a narrowly scoped serializer/minifier compatibility PR with the actual CSS worker/minification path, malformed options and strict build. Do not force a graph-wide override without those checks. |
| Compiler/generated helpers | `react-scripts → Babel` (core 7.23.5/helpers 7.23.5); **GHSA-4x5r-pxfx-6jf8**, **GHSA-968p-4wvh-cqc8** | Source-map file-read and emitted named-group regex behavior need separate review. No user source-code ingestion is added; source-map absence does not prove generated helpers safe. Assess compatible compiler/helper patch versions and actual generated-output regressions. |
| CSS/SVG build input | PostCSS and SVGO paths listed in comparison; e.g. **GHSA-6g55-p6wh-862q**, **GHSA-fxqj-rqcc-2cmp**, **GHSA-r28c-9q8g-f849**, **GHSA-2p49-hgcm-8545** | Build-time source-map reads/SVG script-removal boundaries remain. Photo intake does not accept SVG and Sharp outputs WebP; these libraries are not the public image sanitizer. Preserve trusted build inputs and secret-free PR CI; review compatible patches independently. |
| Development server | `react-scripts → webpack-dev-server@4.15.1`; **GHSA-9jgg-88mc-972h**, **GHSA-4v9v-hfq4-rm2v**, **GHSA-79cf-xcqc-c78w**, **GHSA-mx8g-39q3-5c79**, **GHSA-f5vj-f2hx-8m93**, **GHSA-m28w-2pqf-7qgj** | Cross-origin source exposure/HMR/internal endpoints/malformed headers matter to developer browsing, not only public servers. Loopback binding alone does not eliminate malicious-site attacks. Never serve public production with CRA dev server; separately assess compatible patching or reviewed toolchain work. F5's browser harness serves a strict build, not this dev server. |
| Backend production/test | Current full and omit-dev audit: zero affected entries | Existing dependency compatibility and real storage tests remain required. Zero audit entries do not prove application security; no backend dependency patch was made. |

These are existing risks made explicit by the checkpoint, **not new advisory
content introduced by F5**. No framework migration, force upgrade, production
configuration or cache destruction is included. Separate narrow remediation PRs
must reproduce actual consumer behavior and all current regressions before approval.
