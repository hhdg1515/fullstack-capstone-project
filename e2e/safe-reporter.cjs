// Never publish raw Playwright call logs, screenshots, traces, cookies or passwords.
class SafeReporter {
  onBegin(config, suite) { console.log(JSON.stringify({ e2eTests: suite.allTests().length, workers: config.workers })); }
  onTestEnd(test, result) {
    console.log(JSON.stringify({ test: test.titlePath().filter(Boolean).join(' / '), status: result.status,
      ...(result.status === 'failed' || result.status === 'timedOut' ? { failure: 'Assertion failed; inspect the named source test privately. Raw error/call details suppressed.', location: result.error?.stack?.match(/(?:\/|\\)e2e(?:\/|\\)[^\s:]+\.cjs:\d+:\d+/)?.[0] || test.location } : {}) }));
  }
  onStepEnd(test, result, step) { if (step.category === 'test.step') console.log(JSON.stringify({ checkpoint: step.title, status: step.error ? 'failed' : 'passed' })); }
  onError() { console.error('E2E infrastructure failed; raw error details suppressed to protect configuration and credentials.'); }
  onEnd(result) { console.log(JSON.stringify({ e2eResult: result.status })); }
}
module.exports = SafeReporter;
