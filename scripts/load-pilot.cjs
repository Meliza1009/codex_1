// Local QA loader: compiles only this application's TypeScript, never target repository code.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src/lib');
function load(name) {
  const filename = path.join(root, name + '.ts');
  const source = fs.readFileSync(filename, 'utf8').replace('import "server-only";', '');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const local = new Module(filename, module);
  local.filename = filename;
  local.paths = module.paths;
  local.require = (request) => request === './investigation' ? load('investigation') : require(request);
  local._compile(compiled, filename);
  return local.exports;
}
module.exports = load;
