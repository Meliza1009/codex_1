const assert = require('node:assert/strict');
const load = require('./load-pilot.cjs');
const { streamPilotRun } = load('pilot');
const { normalizeQuery, candidateScore, relatedPaths, proposedDiff } = load('investigation');
const analysis = { kinds: ['validation'], summary: 'Reject empty names', expectedBehavior: 'Empty names rejected', observedBehavior: 'Empty names accepted', importantSymbols: ['validateName'], importantPaths: ['src/validator.ts'], errorMessages: [], likelyEvidenceSurfaces: ['validator', 'test'], maintainerClarifications: [], reproductionDetails: [], proposedApproaches: [], constraints: [] };
for (const query of ['index', 'package', 'source', 'the export map and readme', 'Search package.json and build configuration to understand runtime entry points']) assert.equal(normalizeQuery(query), null);
for (const query of ['clsx/lite', 'moduleResolution', 'typesVersions', 'ClassValue', 'declare namespace clsx']) assert.equal(normalizeQuery(query), query);
assert.ok(candidateScore('src/validator.ts', analysis, new Set()) > candidateScore('src/unrelated.ts', analysis, new Set()));
const apiAnalysis = { ...analysis, kinds: ['api_change'], importantPaths: [], importantSymbols: ['clsx.arr()'] };
assert.ok(candidateScore('src/index.js', apiAnalysis, new Set()) > candidateScore('bench/index.js', apiAnalysis, new Set()));
assert.equal(normalizeQuery('clsx(...)'), 'clsx');
assert.equal(normalizeQuery('clsx.arr()'), 'clsx.arr');
assert.deepEqual(relatedPaths('src/a.ts', 'import { x } from "./b.js";', ['src/b.ts']), ['src/b.ts']);
assert.equal(proposedDiff('a.ts', 'one\ntwo\n', 'one\nthree\n').additions, 1);
assert.match(proposedDiff('a.ts', 'one', 'two').diff, /No newline at end of file/);

async function scenario(name, options = {}) {
  let gates = 0, reviews = 0, coderCalls = 0, malformed = 0, plans = 0;
  const files = { 'src/validator.ts': 'export const validateName = (name: string) => true;\n', ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`src/follow${i}.ts`, `export const follow${i} = true;\n`])) };
  const events = [];
  await streamPilotRun('https://github.com/fixture/repo/issues/1', (event) => events.push(structuredClone(event)), {
    github: async (path) => {
      if (path.endsWith('/issues/1')) return { number: 1, title: 'Reject empty names', body: 'validateName should reject empty strings', comments: 0, html_url: 'https://github.com/fixture/repo/issues/1', state: 'open' };
      if (path.endsWith('/languages')) return { TypeScript: 100 };
      if (path.includes('/git/trees/')) return { tree: Object.keys(files).map((path) => ({ path, type: 'blob', size: 100 })), truncated: false };
      if (path.includes('/contents/')) return files[decodeURIComponent(path.split('/contents/')[1].split('?')[0])];
      return { default_branch: 'main', size: 1, private: false, archived: false, disabled: false, html_url: 'https://github.com/fixture/repo' };
    },
    runCodex: async (prompt, schema) => {
      if (options.malformed && malformed++ < (options.recover ? 1 : 99)) return '{ broken';
      if (schema.required.includes('kinds')) return JSON.stringify(analysis);
      if (schema.required.includes('decision')) {
        gates++;
        assert.ok(prompt.includes('priorSearchQueries') && prompt.includes('remainingSearchBudget'));
        const keepGoing = options.budget || gates < (options.rounds || 1);
        return JSON.stringify({ decision: options.outOfScope ? 'out_of_scope' : keepGoing ? 'continue' : 'ready_to_patch', requiredCapability: options.outOfScope ? 'hardware' : 'none', reason: options.outOfScope ? 'Resolution requires measurements from the reported hardware device.' : keepGoing ? 'A referenced validation rule must be checked.' : 'Validator and requested behavior are established.', missingEvidence: keepGoing ? [{ fact: 'Whether a referenced rule rejects empty names', whyNeeded: 'Needed to avoid contradicting the public validation contract' }] : [], searchQueries: keepGoing ? ['validateName', `follow${gates}`] : [], filesToInspect: keepGoing ? [`src/follow${gates}.ts`] : [], repeatJustifications: [], confidence: .85, evidence: options.cumulative && gates > 1 ? [{ path: 'src/follow1.ts', relevance: 'Referenced rule', findings: ['Exports follow1'] }] : [{ path: 'src/validator.ts', relevance: 'Owns name validation', findings: ['Always returns true'] }] });
      }
      if (schema.required.includes('goal')) {
        plans++;
        if (options.cumulative) { assert.match(prompt, /Always returns true/); assert.match(prompt, /Referenced rule/); }
        const invalid = options.invalidPlan || (options.repairPlan && plans === 1);
        if (plans === 2) assert.match(prompt, /File was not inspected: invented.ts/);
        const file = invalid ? 'invented.ts' : options.pathAlias ? './src/validator.ts' : options.unsummarized ? 'src/follow0.ts' : 'src/validator.ts';
        assert.match(prompt, /filesAvailableToChange/);
        return JSON.stringify({ goal: 'Reject empty names', filesAllowedToChange: [file], steps: [{ file, action: 'Reject empty strings', reason: 'Match requested behavior' }] });
      }
      if (schema.required.includes('changes')) { coderCalls++; if (coderCalls === 2) { assert.match(prompt, /REVIEWER FEEDBACK/); assert.match(prompt, /PREVIOUS PROPOSED CONTENTS/); } return JSON.stringify({ changes: [{ path: options.badPath ? 'src/secret.ts' : options.unsummarized ? 'src/follow0.ts' : 'src/validator.ts', updatedContent: 'export const validateName = (name: string) => name.length > 0;\n', explanation: 'Reject empty names' }] }); }
      reviews++;
      const revise = (options.revise && reviews === 1) || options.reviewFails;
      return JSON.stringify({ verdict: revise ? 'revise' : 'approve', requirementsCovered: !revise, unrelatedChanges: false, likelySyntaxRisk: false, apiBreakageRisk: false, evidenceSupported: true, missingRequirements: revise ? ['Empty strings must be rejected'] : [], feedback: revise ? ['Add empty-string validation'] : [] });
    },
  });
  const terminal = events.at(-1);
  if (options.invalidPlan) { assert.equal(terminal.error.code, 'PLAN_SCOPE_INVALID'); assert.match(terminal.error.message, /invented.ts/); assert.equal(plans, 2); assert.equal(coderCalls, 0); }
  else if (options.malformed && !options.recover) { assert.equal(terminal.error.code, 'MALFORMED_AGENT_OUTPUT'); }
  else {
    assert.equal(terminal.type, 'completed'); const run = terminal.run;
    assert.ok(run.stages.every((stage) => !['pending', 'active'].includes(stage.status)));
    assert.equal(new Set(run.searches.map((search) => search.query.toLowerCase())).size, run.searches.length);
    assert.equal(new Set(run.inspectedFiles.map((file) => file.path)).size, run.inspectedFiles.length);
    if (options.outOfScope || options.budget || options.badPath || options.reviewFails) { assert.equal(run.status, 'refused'); assert.equal(run.patch, ''); }
    else { assert.equal(run.status, 'completed'); assert.ok(run.patch.includes('+export')); assert.equal(run.metrics.explorationRounds, options.rounds || 1); }
    if (options.budget) { assert.equal(run.refusal.code, 'BUDGET_EXHAUSTED'); assert.doesNotMatch(run.refusal.suggestedNextStep, /runtime/); }
    if (options.revise || options.reviewFails) { assert.equal(reviews, 2); assert.equal(coderCalls, 2); }
    if (options.outOfScope) assert.equal(run.refusal.code, 'OUT_OF_SCOPE_HARDWARE');
  }
  console.log(`PASS ${name}`);
}
(async () => {
  await scenario('one-round success');
  await scenario('targeted second-round exploration', { rounds: 2 });
  await scenario('fifth-round convergence', { rounds: 5 });
  await scenario('explicit capability refusal', { outOfScope: true });
  await scenario('budget exhaustion preserves missing facts', { budget: true });
  await scenario('one genuine revision', { revise: true });
  await scenario('second review refuses and publishes no patch', { reviewFails: true });
  await scenario('unapproved coder path refused', { badPath: true });
  await scenario('malformed output controlled failure', { malformed: true });
  await scenario('malformed output retry recovery', { malformed: true, recover: true });
  await scenario('evidence persists across exploration rounds', { rounds: 2, cumulative: true });
  await scenario('inspected file omitted from summary remains plannable', { unsummarized: true });
  await scenario('relative path spelling normalized', { pathAlias: true });
  await scenario('invalid plan repaired using exact validation feedback', { repairPlan: true });
  await scenario('invented plan paths fail with specific diagnostics', { invalidPlan: true });
})().catch((error) => { console.error(error); process.exitCode = 1; });
