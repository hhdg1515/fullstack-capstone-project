// Offline F2 snapshot derivation. npm audit/build are separate explicit commands.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'docs/verification/m65f2');
const base = 'a72915ea8536b34054302687277c1f8de36af1ab';
const read = name => JSON.parse(fs.readFileSync(path.join(out, name)));
const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function lock(scope, before) {
  const file = 'giftlink-' + scope + '/package-lock.json';
  const bytes = before ? execFileSync('git', ['show', base + ':' + file], { cwd: root }) : fs.readFileSync(path.join(root, file));
  return { packages: JSON.parse(bytes).packages, sha256: hash(bytes) };
}
function resolve(packages, from, name) {
  for (let at = from; ; at = path.posix.dirname(at)) {
    const candidate = (at && at !== '.' ? at + '/' : '') + 'node_modules/' + name;
    if (packages[candidate]) return candidate;
    if (!at || at === '.') break;
  }
}
function classify(packages, scope) {
  const roles = new Map(), mark = (node, role) => { if (!roles.has(node)) roles.set(node, new Set()); roles.get(node).add(role); };
  function walk(name, role) {
    const start = resolve(packages, '', name), seen = new Set(), pending = start ? [start] : [];
    while (pending.length) {
      const node = pending.pop(); if (seen.has(node)) continue; seen.add(node); mark(node, role);
      for (const dep of Object.keys(Object.assign({}, packages[node].dependencies, packages[node].optionalDependencies))) {
        const next = resolve(packages, node, dep); if (next) pending.push(next);
      }
    }
  }
  if (scope === 'backend') {
    for (const [name] of Object.entries(packages[''].dependencies || {})) walk(name, 'production backend');
    walk('jshint', 'development/lint'); walk('mocha', 'test tooling');
  } else {
    for (const name of ['webpack', 'babel-loader', '@babel/core', 'babel-preset-react-app', '@svgr/webpack', 'postcss', 'css-loader', 'eslint', 'workbox-webpack-plugin']) walk(name, 'build tooling');
    for (const name of ['webpack-dev-server', 'react-dev-utils', 'launch-editor']) walk(name, 'development server/tooling');
    for (const name of ['jest', 'babel-jest', 'jest-environment-jsdom', '@testing-library/react', '@testing-library/jest-dom', '@testing-library/user-event']) walk(name, 'test tooling');
    mark('node_modules/react-scripts', 'build/development/test entry');
  }
  return roles;
}
function browser(phase) {
  return new Set(read(phase + '-browser-sources.json').map(source => source.split('node_modules/').pop().match(/^(@[^/]+\/[^/]+|[^/]+)/)?.[0]).filter(Boolean));
}
const inventory = [], deltas = {}, hashes = {}, counts = {};
for (const scope of ['backend', 'frontend']) {
  const before = lock(scope, true), after = lock(scope, false), roles = classify(before.packages, scope), rolesAfter = classify(after.packages, scope);
  const oldAudit = read('before-' + scope + '.json'), newAudit = read('after-' + scope + '.json');
  counts[scope] = { before: oldAudit.metadata.vulnerabilities, after: newAudit.metadata.vulnerabilities };
  hashes[scope] = { before: before.sha256, after: after.sha256 };
  deltas[scope] = [...new Set([...Object.keys(before.packages), ...Object.keys(after.packages)])].sort()
    .filter(node => before.packages[node]?.version !== after.packages[node]?.version)
    .map(node => ({ node, before: before.packages[node]?.version || null, after: after.packages[node]?.version || null }));
  const browserBefore = scope === 'frontend' ? browser('before') : new Set(), browserAfter = scope === 'frontend' ? browser('after') : new Set();
  for (const name of [...new Set([...Object.keys(oldAudit.vulnerabilities), ...Object.keys(newAudit.vulnerabilities)])].sort()) {
    const old = oldAudit.vulnerabilities[name], current = newAudit.vulnerabilities[name], via = (current || old).via;
    const execution = new Set();
    for (const node of old?.nodes || []) for (const role of roles.get(node) || []) execution.add(role);
    for (const node of current?.nodes || []) for (const role of rolesAfter.get(node) || []) execution.add(role);
    if (browserBefore.has(name) || browserAfter.has(name)) execution.add('browser module observed');
    inventory.push({ scope, package: name, direct: Boolean((current || old).isDirect), beforeSeverity: old?.severity || null,
      afterSeverity: current?.severity || null, execution: execution.size ? [...execution].sort() : ['installed/unmapped; manual review required'],
      browserModuleBefore: browserBefore.has(name), browserModuleAfter: browserAfter.has(name),
      beforeNodes: old?.nodes || [], afterNodes: current?.nodes || [],
      directAdvisories: via.filter(item => typeof item === 'object').map(item => ({ id: item.url.split('/').pop(), url: item.url, severity: item.severity, affectedRange: item.range, title: item.title })),
      inheritedFrom: via.filter(item => typeof item === 'string') });
  }
}
write('package-triage.json', { caveat: 'Execution classes are lockfile consumer paths and production source-map observations, NOT proof of exploitability/non-reachability. Generated code, lazy paths and platform-specific behavior require manual review.', packages: inventory });
write('lock-delta.json', deltas);
write('summary.json', { baseline: base, observedDateUtc: '2026-10-30', node: process.version, npm: '10.9.9', counts,
  backendRuntime: { before: read('before-backend-runtime.json').metadata.vulnerabilities, after: read('after-backend-runtime.json').metadata.vulnerabilities }, lockHashes: hashes,
  packageCountCaveat: 'Affected package entries include inherited findings; they are not distinct confirmed application vulnerabilities.',
  auditExitCodes: { beforeBackend: 1, afterBackend: 0, beforeBackendRuntime: 0, afterBackendRuntime: 0, beforeFrontend: 1, afterFrontend: 1 } });
console.log(JSON.stringify({ mode: 'offline-evidence', packagesTriaged: inventory.length, backendChangedPaths: deltas.backend.length, frontendChangedPaths: deltas.frontend.length }));
