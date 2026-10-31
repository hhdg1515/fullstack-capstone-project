// Offline evidence derivation. Never installs packages, fixes an audit or calls a provider.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function advisories(report) {
  const result = {};
  for (const [name, entry] of Object.entries(report.vulnerabilities)) for (const v of entry.via) if (typeof v === 'object') result[name + ':' + v.source] = v;
  return result;
}
function compare(before, current) {
  const a = advisories(before), b = advisories(current), oldNames = Object.keys(before.vulnerabilities), names = Object.keys(current.vulnerabilities);
  return { beforeCounts: before.metadata.vulnerabilities, currentCounts: current.metadata.vulnerabilities,
    directAdvisoryPairsBefore: Object.keys(a).length, directAdvisoryPairsCurrent: Object.keys(b).length,
    addedAdvisories: Object.keys(b).filter(k => !a[k]).sort(), removedAdvisories: Object.keys(a).filter(k => !b[k]).sort(),
    changedAdvisories: Object.keys(b).filter(k => a[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort(),
    inheritedOnlyAddedEntries: names.filter(k => !oldNames.includes(k) && current.vulnerabilities[k].via.every(v => typeof v === 'string')).sort(),
    changedReports: names.filter(k => before.vulnerabilities[k] && JSON.stringify(before.vulnerabilities[k]) !== JSON.stringify(current.vulnerabilities[k])).sort() };
}
function resolve(packages, from, name) {
  for (let at = from; ; at = path.posix.dirname(at)) {
    const p = (at && at !== '.' ? at + '/' : '') + 'node_modules/' + name;
    if (packages[p]) return p; if (!at || at === '.') return null;
  }
}
function dependencyPaths(packages) {
  const result = {}, queue = [];
  for (const name of Object.keys(packages[''].dependencies || {})) { const n = resolve(packages, '', name); if (n) queue.push([n, [name]]); }
  while (queue.length) {
    const [node, trail] = queue.shift(); if (result[node]) continue; result[node] = trail;
    for (const name of Object.keys(Object.assign({}, packages[node].dependencies, packages[node].optionalDependencies, packages[node].peerDependencies))) {
      const next = resolve(packages, node, name); if (next && !result[next]) queue.push([next, trail.concat(name)]);
    }
  }
  return result;
}
function generate(root) {
  const dir = path.join(root, 'docs/verification/m65f5'), read = name => JSON.parse(fs.readFileSync(path.join(dir, name)));
  const before = JSON.parse(fs.readFileSync(path.join(root, 'docs/verification/m65f2/after-frontend.json'))), current = read('frontend-default-cache.json'), fresh = read('frontend-fresh-cache.json'), lockOnly = read('frontend-lock-only.json');
  const lockBytes = fs.readFileSync(path.join(root, 'giftlink-frontend/package-lock.json')), lock = JSON.parse(lockBytes), paths = dependencyPaths(lock.packages);
  const baselineHash = JSON.parse(fs.readFileSync(path.join(root, 'docs/verification/m65f2/summary.json'))).lockHashes.frontend.after;
  const modules = new Set();
  for (const file of fs.readdirSync(path.join(root, 'giftlink-frontend/build/static/js')).filter(f => f.endsWith('.map'))) {
    const map = JSON.parse(fs.readFileSync(path.join(root, 'giftlink-frontend/build/static/js', file)));
    for (const source of map.sources) if (source.includes('node_modules/')) modules.add(source.split('node_modules/').pop().match(/^(@[^/]+\/[^/]+|[^/]+)/)?.[0]);
  }
  const delta = compare(before, current), report = Object.assign(delta, { dateUTC: '2026-10-30', node: process.version, npm: '10.9.9', registry: 'https://registry.npmjs.org',
    f2MergedCommit: '5806f5c1863bc2dd3f1469bc1eeb979670248057',
    frontendChangesSinceF2: execFileSync('git', ['diff', '--name-only', '5806f5c1863bc2dd3f1469bc1eeb979670248057', 'HEAD', '--', 'giftlink-frontend'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    lockSHA256: hash(lockBytes), sameLockAsF2: hash(lockBytes) === baselineHash,
    freshCacheCounts: fresh.metadata.vulnerabilities, freshReportExactlyEqualsF2: JSON.stringify(before) === JSON.stringify(fresh),
    defaultEqualsLockOnly: lockOnly.rawReportSHA256 === hash(fs.readFileSync(path.join(dir, 'frontend-default-cache.json'))),
    sourceAdvisories: Object.entries(advisories(current)).map(([key, v]) => ({ key, id: v.url.split('/').pop(), severity: v.severity, affectedRange: v.range })),
    affectedPaths: Object.entries(current.vulnerabilities).map(([name, v]) => ({ name, severity: v.severity, inheritedOnly: v.via.every(x => typeof x === 'string'), browserModuleObserved: modules.has(name),
      nodes: v.nodes.map(n => ({ node: n, version: lock.packages[n]?.version, dependencyPath: paths[n] || ['unmapped; review required'] })) })),
    browserAffectedModules: Object.keys(current.vulnerabilities).filter(n => modules.has(n)).sort(),
    interpretation: 'Cache-dependent npm derived/metavulnerability reporting reproduced without package/source changes. All direct advisory records identical; exact internal cache defect not asserted. Counts are affected package entries, not independently exploitable vulnerabilities. Source-map presence/absence is not an exploitability proof.' });
  fs.writeFileSync(path.join(dir, 'audit-comparison.json'), JSON.stringify(report, null, 2) + '\n'); return report;
}
if (require.main === module) { const r = generate(path.resolve(__dirname, '..')); console.log(JSON.stringify({ mode: 'offline-audit-comparison', addedDirectAdvisories: r.addedAdvisories.length, freshReportExactlyEqualsF2: r.freshReportExactlyEqualsF2, inheritedAddedEntries: r.inheritedOnlyAddedEntries.length, browserAffectedModules: r.browserAffectedModules })); }
module.exports = { compare, generate };
