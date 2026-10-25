const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { authorizeWorkflow, authorizeEnvironment, authorizeTarget, WorkflowAuthorizationError } = require('./authorize-workflow.cjs');
const { staging } = require('../deployment/staging-target.cjs');
const context = { E2E_AUTH_REPOSITORY: 'hhdg1515/fullstack-capstone-project', E2E_AUTH_OWNER: 'hhdg1515',
  E2E_AUTH_EVENT: 'workflow_dispatch', E2E_AUTH_REF: 'refs/heads/main', E2E_AUTH_ACTOR: 'hhdg1515', E2E_AUTH_ACTOR_ID: '144937930',
  E2E_AUTH_TRIGGERING_ACTOR: 'hhdg1515', E2E_AUTH_SHA: 'a'.repeat(40), E2E_AUTH_APPROVED_SHA: 'a'.repeat(40), E2E_AUTH_OPERATION: 'preview' };
function target(operation) {
  return { ...context, E2E_AUTH_OPERATION: operation, E2E_OPERATION: operation, E2E_APPROVE_OPERATION: operation,
    E2E_APP_ORIGIN: staging.frontendOrigin, E2E_DB_NAME: staging.database, E2E_EXPECTED_TARGET: staging.fingerprint,
    E2E_CONFIRM_ORIGIN: operation === 'preview' ? '' : staging.frontendOrigin, E2E_CONFIRM_DB: operation === 'preview' ? '' : staging.database,
    E2E_CONFIRM_ENVIRONMENT: operation === 'preview' ? '' : 'staging', E2E_CONFIRM_TARGET: operation === 'preview' ? '' : staging.fingerprint,
    E2E_RUN_ID: operation === 'cleanup' ? 'b'.repeat(32) : '' };
}
const category = value => error => error instanceof WorkflowAuthorizationError && error.category === value;

test('the sole owner can explicitly preview, run and clean up with no second account or reviewer', () => {
  for (const operation of ['preview', 'run', 'cleanup']) {
    assert.equal(authorizeWorkflow(target(operation)), operation);
    assert.equal(authorizeTarget(target(operation)), operation);
  }
  authorizeEnvironment({ name: 'isolated-e2e', protection_rules: [] });
  authorizeEnvironment({ name: 'isolated-e2e' });
  authorizeEnvironment({ name: 'isolated-e2e', protection_rules: [{ type: 'required_reviewers', reviewers: [] }] });
});

test('unauthorized original actors, actor IDs and rerun actors are refused even for an original owner run', () => {
  for (const changes of [{ E2E_AUTH_ACTOR: 'collaborator' }, { E2E_AUTH_ACTOR_ID: '999' }, { E2E_AUTH_ACTOR: 'github-actions[bot]' },
    { E2E_AUTH_ACTOR: '' }, { E2E_AUTH_ACTOR_ID: '' }]) assert.throws(() => authorizeWorkflow({ ...context, ...changes }), category('owner_actor_required'));
  for (const value of ['collaborator', 'github-actions[bot]', '', undefined]) {
    assert.throws(() => authorizeWorkflow({ ...context, E2E_AUTH_TRIGGERING_ACTOR: value }), category('owner_rerun_required'));
  }
});

test('wrong repositories, owners, branches, tags and automatic/caller events cannot authorize E2E', () => {
  for (const changes of [{ E2E_AUTH_REPOSITORY: 'fork/fullstack-capstone-project' }, { E2E_AUTH_OWNER: 'other' }]) {
    assert.throws(() => authorizeWorkflow({ ...context, ...changes }), category('repository_not_allowed'));
  }
  for (const ref of ['refs/heads/feature', 'refs/tags/main', '', undefined]) {
    assert.throws(() => authorizeWorkflow({ ...context, E2E_AUTH_REF: ref }), category('main_branch_required'));
  }
  for (const event of ['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_call', 'repository_dispatch', '']) {
    assert.throws(() => authorizeWorkflow({ ...context, E2E_AUTH_EVENT: event }), category('manual_dispatch_required'));
  }
});

test('the full approved SHA must match the immutable run SHA and the operation must be explicit', () => {
  for (const value of ['', 'main', 'a'.repeat(7), 'b'.repeat(40), 'A'.repeat(40)]) {
    assert.throws(() => authorizeWorkflow({ ...context, E2E_AUTH_APPROVED_SHA: value }), category('approved_sha_mismatch'));
  }
  assert.throws(() => authorizeWorkflow({ ...context, E2E_AUTH_SHA: 'b'.repeat(40) }), category('approved_sha_mismatch'));
  for (const operation of ['', 'deploy', 'apply', 'all']) {
    assert.throws(() => authorizeWorkflow({ ...context, E2E_AUTH_OPERATION: operation }), category('operation_not_allowed'));
  }
});

test('an existing isolated-e2e Environment is still mandatory; reviewer metadata is not an authorization prerequisite', () => {
  for (const value of [undefined, null, {}, { name: 'production' }]) assert.throws(() => authorizeEnvironment(value), category('existing_environment_required'));
  authorizeEnvironment({ name: 'isolated-e2e', protection_rules: [{ type: 'wait_timer' }] });
});

test('every operation refuses the wrong origin, database or approved fingerprint before any remote connection', () => {
  for (const operation of ['preview', 'run', 'cleanup']) {
    for (const origin of [staging.productionFrontendOrigin, staging.apiOrigin, 'https://another-staging.vercel.app', '']) {
      assert.throws(() => authorizeTarget({ ...target(operation), E2E_APP_ORIGIN: origin }), category('staging_origin_mismatch'));
    }
    for (const db of ['production', 'giftdb', 'moveout_e2e_unapproved', '']) {
      assert.throws(() => authorizeTarget({ ...target(operation), E2E_DB_NAME: db }), category('staging_database_mismatch'));
    }
    for (const fingerprint of ['a'.repeat(64), '', 'not-approved']) {
      assert.throws(() => authorizeTarget({ ...target(operation), E2E_EXPECTED_TARGET: fingerprint }), category('approved_target_mismatch'));
    }
  }
});

test('run and cleanup retain exact independent operation/origin/database/staging/fingerprint confirmations', () => {
  for (const operation of ['run', 'cleanup']) {
    for (const key of ['E2E_CONFIRM_ORIGIN', 'E2E_CONFIRM_DB', 'E2E_CONFIRM_ENVIRONMENT', 'E2E_CONFIRM_TARGET']) {
      assert.throws(() => authorizeTarget({ ...target(operation), [key]: '' }), category('write_confirmation_mismatch'));
      assert.throws(() => authorizeTarget({ ...target(operation), [key]: 'incorrect' }), category('write_confirmation_mismatch'));
    }
    for (const key of ['E2E_OPERATION', 'E2E_APPROVE_OPERATION']) {
      assert.throws(() => authorizeTarget({ ...target(operation), [key]: 'preview' }), category('operation_mismatch'));
    }
  }
  assert.equal(authorizeTarget(target('preview')), 'preview');
});

test('cleanup requires the exact owned run ID and preview validates optional cleanup IDs without authorizing writes', () => {
  for (const id of ['', 'wrong', '../outsider', 'b'.repeat(31)]) {
    assert.throws(() => authorizeTarget({ ...target('cleanup'), E2E_RUN_ID: id }), category('owned_run_id_required'));
  }
  assert.equal(authorizeTarget({ ...target('preview'), E2E_RUN_ID: 'b'.repeat(32) }), 'preview');
  assert.throws(() => authorizeTarget({ ...target('preview'), E2E_RUN_ID: 'outsider' }), category('owned_run_id_required'));
});

test('both workflow jobs guard trusted actors and branches, including a failed verify-job rerun', () => {
  const source = fs.readFileSync(path.join(__dirname, '../.github/workflows/isolated-e2e.yml'), 'utf8');
  for (const job of ['gate', 'verify']) {
    const block = source.split('\n  ' + job + ':\n')[1]; assert.ok(block, job);
    const expression = block.match(/    if: >-\n((?:      [^\n]+\n)+)/)?.[1]; assert.ok(expression, job);
    // Evaluate only this workflow's simple, literal equality/AND predicates.
    assert.match(expression.trim(), /^(?:(?:github\.[a-z_]+|needs\.gate\.result)\s*==\s*'[A-Za-z0-9_./:-]+'\s*(?:&&\s*|$))+$/);
    const permits = new Function('github', 'needs', 'return (' + expression + ');');
    const trusted = { repository: context.E2E_AUTH_REPOSITORY, repository_owner: context.E2E_AUTH_OWNER,
      event_name: context.E2E_AUTH_EVENT, ref: context.E2E_AUTH_REF, actor: context.E2E_AUTH_ACTOR,
      actor_id: context.E2E_AUTH_ACTOR_ID, triggering_actor: context.E2E_AUTH_TRIGGERING_ACTOR };
    const succeeded = { gate: { result: 'success' } };
    assert.equal(permits(trusted, succeeded), true);
    for (const change of [{ actor: 'collaborator' }, { actor_id: '999' }, { triggering_actor: 'collaborator' },
      { event_name: 'push' }, { ref: 'refs/heads/feature' }, { repository: 'fork/project' }, { repository_owner: 'other' }]) {
      assert.equal(permits({ ...trusted, ...change }, succeeded), false, job);
    }
    if (job === 'verify') for (const result of ['failure', 'skipped', 'cancelled']) assert.equal(permits(trusted, { gate: { result } }), false);
  }
});

test('the CLI validates target confirmations and reports safe failure categories without printing inputs or credentials', () => {
  const file = path.join(__dirname, 'authorize-workflow.cjs');
  const env = { ...target('run'), E2E_MONGO_URL: 'private-credential-sentinel' };
  const accepted = spawnSync(process.execPath, [file, 'target'], { env, encoding: 'utf8' });
  assert.equal(accepted.status, 0);
  const refused = spawnSync(process.execPath, [file, 'target'], { env: { ...env, E2E_CONFIRM_DB: 'private-input-sentinel' }, encoding: 'utf8' });
  assert.equal(refused.status, 1); assert.ok(refused.stderr.includes('write_confirmation_mismatch'));
  assert.ok(!/private-credential-sentinel|private-input-sentinel/.test(accepted.stdout + refused.stdout + refused.stderr));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-e2e-'));
  try {
    const metadata = path.join(directory, 'environment.json'); fs.writeFileSync(metadata, JSON.stringify({ name: 'isolated-e2e', protection_rules: [] }));
    const environment = spawnSync(process.execPath, [file, 'environment', metadata], { env, encoding: 'utf8' });
    assert.equal(environment.status, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
