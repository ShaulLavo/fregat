import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileHashes, packageRoot, upstreamRoot } from './support.mjs'

// These probes run only in disposable builds, never in dist/ or the timing workers.

const extraAmounts = {
  'buffers.extendBufferLineIndex': ['indexInputCodeUnits', 'text.length - index.scannedLength'],
  'buffers.countLineBreaks': ['inputCodeUnits', 'end - start'],
  'buffers.growTailLineIndex': ['indexInputCodeUnits', 'text.length'],
  'buffers.PieceBufferChunkView.fork': ['copiedArraySlots', 'this.size + this.bufferCount'],
  'pieceTreeBase.createLineStarts': ['indexInputCodeUnits', 'str.length'],
  'pieceTreeBase.createLineStartsFast': ['indexInputCodeUnits', 'str.length'],
}

function functionName(node) {
  if (ts.isConstructorDeclaration(node)) return node.parent.name.text + '.constructor'
  if (ts.isMethodDeclaration(node) && ts.isClassDeclaration(node.parent))
    return node.parent.name.text + '.' + node.name.getText()
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if (ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent))
    return node.parent.name.getText()
  return null
}

export function instrument(text, filename) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(source.parseDiagnostics.length, 0, `Cannot parse ${filename}`)
  assert(!text.includes('__textbufferBenchCounters'), 'Refusing to instrument twice')
  const edits = []
  const manifest = []
  const module = path.basename(filename, '.js')
  const counters = new Set()
  const add = (at, value) => edits.push({ at, value })
  function counter(name, amount = '1') {
    counters.add(name)
    return `;globalThis.__textbufferBenchCounters.add(${JSON.stringify(name)}, ${amount});`
  }
  function prepend(body, value) {
    if (ts.isBlock(body)) add(body.getStart(source) + 1, value)
    else {
      add(body.getStart(source), '{' + value)
      add(body.end, '}')
    }
  }
  function visit(node, owner = null) {
    const name = functionName(node)
    if (name && node.body) {
      const key = module + '.' + name
      manifest.push({ key, line: source.getLineAndCharacterOfPosition(node.pos).line + 1 })
      let entry = counter(key + '.calls')
      const extra = extraAmounts[key]
      if (extra) entry += counter(key + '.' + extra[0], extra[1])
      if (ts.isBlock(node.body)) prepend(node.body, entry)
      else {
        add(node.body.getStart(source), '{' + entry + 'return (')
        add(node.body.end, ');}')
      }
      // A nested named function owns its probes; callbacks inherit their enclosing owner.
      ts.forEachChild(node.body, (child) => visit(child, key))
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
      const width = { Uint16Array: 2, Uint32Array: 4 }[allocation.expression.getText(source)]
      if (width)
        add(
          node.getStart(source),
          counter(
            owner + '.typedArrayCapacityBytes',
            `${allocation.arguments[0].getText(source)} * ${width}`,
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
  const parsed = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(parsed.parseDiagnostics.length, 0, `Probe generated invalid JS: ${filename}`)
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

export function prepareProbes(destination) {
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
  const manifests = {}
  for (const engine of Object.keys(roots)) {
    const original =
      engine === 'singapore' ? path.join(packageRoot, 'dist') : path.join(upstreamRoot, 'dist')
    mkdirSync(roots[engine], { recursive: true })
    cpSync(original, roots[engine], { recursive: true })
    writeFileSync(
      path.join(roots[engine], 'package.json'),
      JSON.stringify({ type: engine === 'singapore' ? 'module' : 'commonjs' }),
    )
    const manifest = []
    const counters = new Set()
    for (const module of selected[engine]) {
      const filename = path.join(roots[engine], module + '.js')
      const instrumented = instrument(readFileSync(filename, 'utf8'), filename)
      writeFileSync(filename, instrumented.text)
      manifest.push(...instrumented.manifest)
      for (const name of instrumented.counters) counters.add(name)
    }
    // Text-matched probes stop matching silently when the source changes; every one is required.
    for (const name of requiredCounters[engine])
      assert(counters.has(name), `Missing probe ${name}: update probes.mjs for the current source`)
    manifests[engine] = {
      probes: manifest,
      counters: Array.from(counters).sort(),
      input: fileHashes(original),
      output: fileHashes(roots[engine]),
    }
  }
  return { roots, manifests }
}
