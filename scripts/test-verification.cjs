const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const load = require('./load-pilot.cjs');
const { verifyPatch } = load('verification');

const FIXTURE_DIR = path.resolve(process.cwd(), '.codex-pilot', 'test-fixtures');

function cleanupDirectory(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function initGitRepo(dir, files = {}) {
  cleanupDirectory(dir);
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email test@test.com && git config user.name test', { cwd: dir, stdio: 'ignore' });

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  execSync('git add . && git commit -m "init"', { cwd: dir, stdio: 'ignore' });
}

async function testPatchApplicationFailure() {
  const repoDir = path.join(FIXTURE_DIR, 'patch-failure-repo');
  initGitRepo(repoDir, {
    'index.js': 'module.exports = 1;\n',
  });

  const invalidPatch = `--- a/non_existent.js
+++ b/non_existent.js
@@ -1,1 +1,1 @@
-hello
+world
`;

  const steps = [];
  const report = await verifyPatch({
    repositoryUrl: repoDir,
    branch: 'main',
    patch: invalidPatch,
    issue: { number: 1, title: 'Bug in index', repository: 'test/repo', url: 'https://github.com/test/repo/issues/1' },
    onStep: (stage) => steps.push({ ...stage }),
  });

  assert.equal(report.result, 'patch_failed');
  assert.equal(report.verdictLabel, 'PATCH FAILED VERIFICATION');
  assert.ok(report.stages.some((s) => s.id === 'patch' && s.status === 'failed'));
  
  // Verify workspace cleanup
  const workspacePath = path.resolve(process.cwd(), report.workspace);
  assert.equal(fs.existsSync(workspacePath), false, 'Temporary workspace must be cleaned up on patch failure');
  console.log('PASS testPatchApplicationFailure');
}

async function testTestFailure() {
  const repoDir = path.join(FIXTURE_DIR, 'test-failure-repo');
  initGitRepo(repoDir, {
    'package.json': JSON.stringify({
      name: 'fixture',
      scripts: {
        test: 'node -e "process.exit(1)"',
      },
    }, null, 2) + '\n',
    'index.js': 'module.exports = 1;\n',
  });

  const validPatch = `--- a/index.js
+++ b/index.js
@@ -1,1 +1,1 @@
-module.exports = 1;
+module.exports = 2;
`;

  const report = await verifyPatch({
    repositoryUrl: repoDir,
    branch: 'main',
    patch: validPatch,
    issue: { number: 2, title: 'Test failing', repository: 'test/repo', url: 'https://github.com/test/repo/issues/2' },
  });

  assert.equal(report.result, 'tests_failed');
  assert.equal(report.verdictLabel, 'PATCH FAILED VERIFICATION');
  assert.ok(report.stages.some((s) => s.id === 'test' && s.status === 'failed'));
  assert.equal(report.commandsDetected?.test, 'npm test');

  // Verify workspace cleanup
  const workspacePath = path.resolve(process.cwd(), report.workspace);
  assert.equal(fs.existsSync(workspacePath), false, 'Temporary workspace must be cleaned up on test failure');
  console.log('PASS testTestFailure');
}

async function testSuccessfulVerification() {
  const repoDir = path.join(FIXTURE_DIR, 'success-repo');
  initGitRepo(repoDir, {
    'package.json': JSON.stringify({
      name: 'fixture',
      scripts: {
        test: 'node test.js',
      },
    }, null, 2) + '\n',
    'index.js': 'module.exports = { value: 1 };\n',
    'test.js': 'const m = require("./index.js"); if (m.value !== 42) process.exit(1);\n',
  });

  const validPatch = `--- a/index.js
+++ b/index.js
@@ -1,1 +1,1 @@
-module.exports = { value: 1 };
+module.exports = { value: 42 };
`;

  let stepCount = 0;
  const report = await verifyPatch({
    repositoryUrl: repoDir,
    branch: 'main',
    patch: validPatch,
    issue: { number: 3, title: 'Fix value', repository: 'test/repo', url: 'https://github.com/test/repo/issues/3' },
    files: [{ path: 'test.js', diff: '', status: 'modified' }],
    onStep: () => { stepCount++; },
  });

  assert.equal(report.result, 'verified');
  assert.equal(report.verdictLabel, 'VERIFIED FIX');
  assert.ok(stepCount > 0, 'onStep callback should have been triggered');
  assert.ok(report.stages.every((s) => s.status === 'passed' || s.status === 'skipped'));
  assert.ok(report.stages.some((s) => s.id === 'workspace' && s.status === 'passed'));
  assert.ok(report.stages.some((s) => s.id === 'patch' && s.status === 'passed'));
  assert.ok(report.stages.some((s) => s.id === 'detect' && s.status === 'passed'));
  assert.ok(report.stages.some((s) => s.id === 'test' && s.status === 'passed'));
  assert.ok(report.stages.some((s) => s.id === 'issue' && s.status === 'passed'));

  // Verify workspace cleanup
  const workspacePath = path.resolve(process.cwd(), report.workspace);
  assert.equal(fs.existsSync(workspacePath), false, 'Temporary workspace must be cleaned up on verification success');
  console.log('PASS testSuccessfulVerification');
}

(async () => {
  try {
    await testPatchApplicationFailure();
    await testTestFailure();
    await testSuccessfulVerification();
    console.log('\nALL VERIFICATION TESTS PASSED');
  } finally {
    cleanupDirectory(FIXTURE_DIR);
  }
})().catch((err) => {
  console.error(err);
  cleanupDirectory(FIXTURE_DIR);
  process.exit(1);
});
