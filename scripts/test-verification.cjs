const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-pilot.cjs');
const { verifyPatch } = load('verification');

(async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/verification.ts'), 'utf8');
  assert.doesNotMatch(source, /child_process|spawn\(|exec\(|git\s+clone|npm\s+(test|install|run)/i);

  let emitted;
  const report = await verifyPatch({
    repositoryUrl: 'https://github.com/example/untrusted',
    branch: 'main',
    commit: 'deadbeef',
    patch: 'diff --git a/a b/a\n',
    issue: { number: 1, title: 'Do not execute', repository: 'example/untrusted', url: 'https://github.com/example/untrusted/issues/1' },
    onStep: (stage) => { emitted = stage; },
  });

  assert.equal(report.result, 'verification_unavailable');
  assert.equal(report.verdictLabel, 'PATCH PROPOSED — NOT EXECUTED');
  assert.match(report.summary, /not performed/i);
  assert.equal(report.stages[0].status, 'skipped');
  assert.equal(emitted?.id, 'workspace');
  console.log('PASS product verification is manual-QA guidance only');
})().catch((error) => { console.error(error); process.exit(1); });
