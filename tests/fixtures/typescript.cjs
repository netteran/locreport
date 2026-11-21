const { existsSync, readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { dirname, resolve } = require('node:path')
const ts = require('typescript')

const root = resolve(__dirname, '..', '..')

/** Transpile a project module for a Node test while honoring explicit dependency stubs. */
function load(file, dependencies = {}, modules = new Map()) {
  const filename = resolve(root, file)
  if (modules.has(filename)) return modules.get(filename).exports
  const module = { exports: {} }
  modules.set(filename, module)
  const requireFromFile = createRequire(filename)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText
  function dependency(id) {
    if (Object.hasOwn(dependencies, id)) return dependencies[id]
    if (id.startsWith('@/') || id.startsWith('.')) {
      const base = id.startsWith('@/') ? resolve(root, id.slice(2)) : resolve(dirname(filename), id)
      const source = [base + '.ts', base + '.tsx'].find(existsSync)
      if (source) return load(source, dependencies, modules)
    }
    return requireFromFile(id)
  }
  new Function('exports', 'require', 'module', code)(module.exports, dependency, module)
  return module.exports
}

module.exports = { load }
