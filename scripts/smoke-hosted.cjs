const assert = require('node:assert/strict');
(async () => {
  const base = process.argv[2] || 'http://localhost:3005';
  const page = await fetch(base); assert.equal(page.status, 200);
  const html = await page.text();
  for (const text of ['SAMPLE RUN', 'Repository evidence', 'Evidence gate', 'Patch proposed', 'Revising patch', 'skipped', 'useTheme.ts']) assert.ok(html.includes(text), `Missing sample UI: ${text}`);
  const run = await fetch(base + '/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issueUrl: 'https://github.com/lukeed/clsx/issues/92' }) });
  assert.match(await run.text(), /hosted_preview/);
  console.log('PASS hosted sample structure and live-execution guard');
})().catch((error) => { console.error(error); process.exitCode = 1; });
