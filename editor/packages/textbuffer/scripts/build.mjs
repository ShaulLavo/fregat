import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const configFile = ts.readConfigFile(path.join(root, 'tsconfig.build.json'), ts.sys.readFile)
if (configFile.error) fail([configFile.error])
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root)
if (config.errors.length) fail(config.errors)
const program = ts.createProgram(config.fileNames, config.options)
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) fail(diagnostics)
rmSync(path.join(root, 'dist'), { recursive: true, force: true })
const result = program.emit(undefined, (filename, text) => {
  mkdirSync(path.dirname(filename), { recursive: true })
  writeFileSync(filename, rewriteImports(filename, text))
})
if (result.emitSkipped || result.diagnostics.length) fail(result.diagnostics)

function fail(diagnostics) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    }),
  )
  throw new Error('Textbuffer build failed')
}

// TypeScript's bundler resolution accepts extensionless imports. Published ESM must not require it.
function rewriteImports(filename, text) {
  if (!filename.endsWith('.js') && !filename.endsWith('.d.ts')) return text
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  const replacements = []
  function visit(node) {
    let literal
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal = node.moduleSpecifier
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      literal = node.argument.literal
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      literal = node.arguments[0]
    if (literal && ts.isStringLiteralLike(literal)) {
      const specifier = literal.text
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)) {
        replacements.push({
          start: literal.getStart(source) + 1,
          end: literal.getEnd() - 1,
          text: specifier + '.js',
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end)
  }
  return text
}
