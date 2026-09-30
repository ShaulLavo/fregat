import type { Engine } from './contracts.ts'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript-api'
import { fileHashes, packageRoot, upstreamRoot } from './support.ts'

// These probes run only in disposable builds, never in dist/ or the timing workers.

const extraAmounts: Record<string, [string, string]> = {
  'buffers.extendBufferLineIndex': ['indexInputCodeUnits', 'text.length - index.scannedLength'],
  'buffers.countLineBreaks': ['inputCodeUnits', 'end - start'],
  'buffers.growTailLineIndex': ['indexInputCodeUnits', 'text.length'],
  'buffers.PieceBufferChunkView.fork': ['copiedArraySlots', 'this.size + this.bufferCount'],
  'pieceTreeBase.createLineStarts': ['indexInputCodeUnits', 'str.length'],
  'pieceTreeBase.createLineStartsFast': ['indexInputCodeUnits', 'str.length'],
}

function functionName(node: ts.Node) {
  if (ts.isConstructorDeclaration(node))
    return (node.parent.name?.text ?? '<anonymous>') + '.constructor'
  if (ts.isMethodDeclaration(node) && ts.isClassDeclaration(node.parent))
    return (node.parent.name?.text ?? '<anonymous>') + '.' + node.name.getText()
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if (ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent))
    return node.parent.name.getText()
  return null
}

export function instrument(text: string, filename: string) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  checkSyntax(text, filename)
  assert(!text.includes('__textbufferBenchCounters'), 'Refusing to instrument twice')
  const edits: { at: number; value: string }[] = []
  const manifest: { key: string; line: number }[] = []
  const module = path.basename(filename, '.js')
  const counters = new Set<string>()
  const add = (at: number, value: string) => edits.push({ at, value })
  function counter(name: string, amount = '1') {
    counters.add(name)
    return `;globalThis.__textbufferBenchCounters.add(${JSON.stringify(name)}, ${amount});`
  }
  function prepend(body: ts.Node, value: string) {
    if (ts.isBlock(body)) add(body.getStart(source) + 1, value)
    else {
      add(body.getStart(source), '{' + value)
      add(body.end, '}')
    }
  }
  function visit(node: ts.Node, owner: string | null = null) {
    const name = functionName(node)
    const body = functionBody(node)
    if (name && body) {
      const key = module + '.' + name
      manifest.push({ key, line: source.getLineAndCharacterOfPosition(node.pos).line + 1 })
      let entry = counter(key + '.calls')
      const extra = extraAmounts[key]
      if (extra) entry += counter(key + '.' + extra[0], extra[1])
      if (ts.isBlock(body)) prepend(body, entry)
      else {
        add(body.getStart(source), '{' + entry + 'return (')
        add(body.end, ');}')
      }
      // A nested named function owns its probes; callbacks inherit their enclosing owner.
      ts.forEachChild(body, (child) => visit(child, key))
      return
    }
    if (
      owner &&
      (ts.isForStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isDoStatement(node))
    )
      prepend(node.statement, counter(owner + '.loopIterations'))
    if (
      owner === 'buffers.pushLineBreakOffset' &&
      ts.isIfStatement(node) &&
      node.expression.getText(source) === 'index.count === index.offsets.length'
    )
      prepend(
        node.thenStatement,
        counter(
          owner + '.typedArrayCapacityBytes',
          'Math.max(index.offsets.length * 2, LINE_INDEX_MIN_CAPACITY) * 4',
        ) + counter(owner + '.typedArrayCopiedBytes', 'index.offsets.byteLength'),
      )
    if (
      owner === 'pieceTreeBase.createUintArray' &&
      ts.isExpressionStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      ts.isNewExpression(node.expression.right)
    ) {
      const allocation = node.expression.right
      const widths: Record<string, number> = { Uint16Array: 2, Uint32Array: 4 }
      const width = widths[allocation.expression.getText(source)]
      if (width)
        add(
          node.getStart(source),
          counter(
            owner + '.typedArrayCapacityBytes',
            `${allocation.arguments?.[0]?.getText(source)} * ${width}`,
          ),
        )
    }
    if (
      owner === 'pieceTreeBase.PieceTreeBase.getLineContent' &&
      ts.isIfStatement(node) &&
      node.expression.getText(source).includes('_lastVisitedLine.lineNumber')
    )
      prepend(node.thenStatement, counter(owner + '.cachedLineHits'))
    ts.forEachChild(node, (child) => visit(child, owner))
  }
  visit(source)
  // Stable ordering at equal positions keeps nested wrappers valid.
  for (const edit of edits.sort((a, b) => b.at - a.at))
    text = text.slice(0, edit.at) + edit.value + text.slice(edit.at)
  checkSyntax(text, filename)
  return { text, manifest, counters: Array.from(counters).sort() }
}

const requiredCounters = {
  singapore: [
    'node.cloneNode.calls',
    'node.own.calls',
    'reverseIndex.appendSlot.calls',
    'reverseIndex.copyBranch.calls',
    'reverseIndex.privateTail.calls',
    'reverseIndex.splitNode.calls',
    'buffers.extendBufferLineIndex.calls',
    'buffers.extendBufferLineIndex.indexInputCodeUnits',
    'buffers.countLineBreaks.inputCodeUnits',
    'buffers.PieceBufferChunkView.fork.copiedArraySlots',
    'buffers.pushLineBreakOffset.typedArrayCapacityBytes',
    'buffers.pushLineBreakOffset.typedArrayCopiedBytes',
  ],
  vscode: [
    'pieceTreeBase.createLineStarts.indexInputCodeUnits',
    'pieceTreeBase.createLineStartsFast.indexInputCodeUnits',
    'pieceTreeBase.createUintArray.typedArrayCapacityBytes',
    'pieceTreeBase.PieceTreeBase.getLineContent.cachedLineHits',
    'rbTreeBase.TreeNode.constructor.calls',
  ],
}

export function prepareProbes(destination: string) {
  const roots = {
    singapore: path.join(destination, 'singapore'),
    vscode: path.join(destination, 'vscode'),
  }
  const selected = {
    singapore: [
      'tree',
      'node',
      'join',
      'reverseIndex',
      'buffers',
      'reads',
      'positions',
      'edits',
      'snapshot',
      'orders',
    ],
    vscode: ['pieceTreeBase', 'pieceTreeBuilder', 'rbTreeBase'],
  }
  const manifests: Partial<
    Record<
      Engine,
      {
        probes: { key: string; line: number }[]
        counters: string[]
        input: Record<string, string>
        output: Record<string, string>
      }
    >
  > = {}
  for (const engine of ['singapore', 'vscode'] as const) {
    const original =
      engine === 'singapore' ? path.join(packageRoot, 'dist') : path.join(upstreamRoot, 'dist')
    mkdirSync(roots[engine], { recursive: true })
    cpSync(original, roots[engine], { recursive: true })
    writeFileSync(
      path.join(roots[engine], 'package.json'),
      JSON.stringify({ type: engine === 'singapore' ? 'module' : 'commonjs' }),
    )
    const manifest: { key: string; line: number }[] = []
    const counters = new Set<string>()
    for (const module of selected[engine]) {
      const filename = path.join(roots[engine], module + '.js')
      const instrumented = instrument(readFileSync(filename, 'utf8'), filename)
      writeFileSync(filename, instrumented.text)
      manifest.push(...instrumented.manifest)
      for (const name of instrumented.counters) counters.add(name)
    }
    // Text-matched probes stop matching silently when the source changes; every one is required.
    for (const name of requiredCounters[engine])
      assert(counters.has(name), `Missing probe ${name}: update probes.ts for the current source`)
    manifests[engine] = {
      probes: manifest,
      counters: Array.from(counters).sort(),
      input: fileHashes(original),
      output: fileHashes(roots[engine]),
    }
  }
  return { roots, manifests }
}

function functionBody(node: ts.Node): ts.ConciseBody | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  )
    return node.body
  return undefined
}
function checkSyntax(text: string, filename: string): void {
  const result = ts.transpileModule(text, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext },
  })
  assert.equal(result.diagnostics?.length ?? 0, 0, `Cannot parse ${filename}`)
}
