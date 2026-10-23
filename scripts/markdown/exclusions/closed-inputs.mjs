import { createHash } from 'node:crypto'

export const inputSha256 = (text) => createHash('sha256').update(text).digest('hex')

class Unresolved extends Error {}

const methods = new Set([
  'slice',
  'substring',
  'repeat',
  'join',
  'concat',
  'replace',
  'replaceAll',
  'trim',
  'trimEnd',
  'trimStart',
  'toUpperCase',
  'toLowerCase',
  'at',
  'includes',
  'startsWith',
  'endsWith',
  'split',
  'charCodeAt',
  'indexOf',
  'lastIndexOf',
  'padStart',
  'padEnd',
])
const globals = { Math, String, Number, Boolean, Array, Object, JSON, undefined }
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype'])

/** Resolves closed source expressions without importing tests or executing application code. */
export function closedInputReader(ts, sources, imported = new Map()) {
  const files = new Map(
    Array.from(sources, ([file, text]) => [
      file,
      ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    ]),
  )
  const host = {
    getSourceFile: (file) => files.get(file),
    getDefaultLibFileName: () => '',
    writeFile() {},
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: (file) => files.has(file),
    readFile: (file) => sources.get(file),
    getCanonicalFileName: (file) => file,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  }
  const program = ts.createProgram(
    Array.from(files.keys()),
    { noResolve: true, noLib: true, allowJs: true },
    host,
  )
  const checker = program.getTypeChecker()
  const calls = new Map()
  const identifiers = new Map()
  const changed = new Map()
  const aliases = []
  const numericIncrementors = new Set()
  for (const sf of files.values()) index(sf)
  for (let pass = 0; pass < aliases.length; pass += 1) propagateWrites()

  function index(node) {
    if (ts.isCallExpression(node)) append(calls, nameOf(node.expression), node)
    if (ts.isIdentifier(node)) append(identifiers, node.text, node)
    indexWrites(node)
    ts.forEachChild(node, index)
  }
  function unwrap(node) {
    while (
      node &&
      (ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isTypeAssertionExpression(node))
    )
      node = node.expression
    return node
  }
  function rootSymbol(node) {
    node = unwrap(node)
    if (!node) return undefined
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      return rootSymbol(node.expression)
    return ts.isIdentifier(node) ? symbol(node) : undefined
  }
  function indexWrites(node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      markWrite(node.left, node)
    if (
      (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
    )
      markWrite(node.operand, node)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      [
        'push',
        'pop',
        'shift',
        'unshift',
        'splice',
        'sort',
        'reverse',
        'fill',
        'copyWithin',
        'set',
        'add',
        'delete',
        'clear',
      ].includes(node.expression.name.text)
    )
      markWrite(node.expression.expression, node)
    if (ts.isDeleteExpression(node)) markWrite(node.expression, node)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      unwrap(node.expression.expression).getText() === 'Object' &&
      ['assign', 'defineProperty', 'defineProperties'].includes(node.expression.name.text)
    )
      markWrite(node.arguments[0], node)
    if (ts.isVariableDeclaration(node) && node.initializer)
      indexAliases(node.name, node.initializer)
  }
  function markWrite(target, node) {
    const key = rootSymbol(target)
    if (!key) return
    if (!changed.has(key)) changed.set(key, new Set())
    changed.get(key).add(node)
  }
  function bindingSymbols(name) {
    if (ts.isIdentifier(name)) return [symbol(name)]
    return name.elements.flatMap((entry) => (entry.name ? bindingSymbols(entry.name) : []))
  }
  function referenceRoots(node) {
    node = unwrap(node)
    if (ts.isIdentifier(node)) {
      if (
        !declaration(node) &&
        Object.hasOwn(globals, node.text) &&
        typeof globals[node.text] !== 'object' &&
        typeof globals[node.text] !== 'function'
      )
        return []
      return [symbol(node)]
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      return referenceRoots(node.expression)
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(referenceRoots)
    if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(referenceRoots)
    if (ts.isShorthandPropertyAssignment(node)) return referenceRoots(node.name)
    if (ts.isPropertyAssignment(node)) return referenceRoots(node.initializer)
    if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node))
      return referenceRoots(node.expression)
    return []
  }
  function indexAliases(name, initializer) {
    const roots = referenceRoots(initializer).filter(Boolean)
    for (const key of bindingSymbols(name).filter(Boolean))
      for (const root of roots) aliases.push([key, root])
  }
  function propagateWrites() {
    for (const [left, right] of aliases) {
      const writes = new Set(
        Array.from(changed.get(left) ?? []).concat(Array.from(changed.get(right) ?? [])),
      )
      if (!writes.size) continue
      changed.set(left, writes)
      changed.set(right, writes)
    }
  }
  function contextCounterWrite(key, write) {
    const loop = write.parent
    if (!numericIncrementors.has(write)) return false
    if (!ts.isForStatement(loop) || loop.incrementor !== write) return false
    const name = loop.initializer?.declarations?.[0]?.name
    return name && ts.isIdentifier(name) && symbol(name) === key
  }
  function checkWrites(key, node, env) {
    const writes = changed.get(key)
    if (!writes) return
    if (env.has(key) && Array.from(writes).every((write) => contextCounterWrite(key, write))) return
    return fail(node, `mutable binding ${node.text}`)
  }
  function symbol(node) {
    const key =
      node.parent && ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node)
    return key ?? (Object.hasOwn(globals, node.text) ? `global:${node.text}` : undefined)
  }
  function nameOf(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text
    return node?.getText() ?? ''
  }
  function fail(node, reason) {
    throw new Unresolved(`${reason}: ${ts.SyntaxKind[node?.kind] ?? 'missing'}`)
  }
  function location(node) {
    const sf = node.getSourceFile()
    const position = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    return {
      file: sf.fileName,
      line: position.line + 1,
      column: position.character + 1,
      expressionSha256: inputSha256(node.getText(sf)),
    }
  }
  function declaration(node) {
    return symbol(node)?.valueDeclaration ?? symbol(node)?.declarations?.[0]
  }
  function readIdentifier(node, env, active) {
    const key = symbol(node)
    checkWrites(key, node, env)
    if (env.has(key)) return env.get(key)
    const declared = declaration(node)
    if (!declared && Object.hasOwn(globals, node.text)) return globals[node.text]
    if (!declared) return fail(node, `unbound ${node.text}`)
    if (ts.isImportSpecifier(declared) || ts.isImportClause(declared)) return readImport(declared)
    if (ts.isFunctionDeclaration(declared)) return { functionNode: declared, env }
    if (ts.isBindingElement(declared)) return readBinding(declared, env, active)
    if (!ts.isVariableDeclaration(declared)) return fail(node, `unbound parameter ${node.text}`)
    if (ts.isForStatement(declared.parent?.parent)) return fail(node, 'unbound loop counter')
    if (!declared.initializer) return fail(node, 'unbound initializer')
    if (active.has(declared)) return fail(node, 'recursive binding')
    return evaluate(declared.initializer, env, new Set(active).add(declared))
  }
  function readImport(node) {
    const value = imported.get(`${node.getSourceFile().fileName}:${node.name.text}`)
    if (value !== undefined) return value
    return Symbol(`unreviewed import ${node.name.text}`)
  }
  function readBinding(node, env, active) {
    let parent = node.parent
    while (parent && !ts.isVariableDeclaration(parent)) parent = parent.parent
    if (!parent?.initializer) return fail(node, 'unbound destructuring')
    const result = new Map(env)
    bind(parent.name, evaluate(parent.initializer, env, active), result, active)
    return result.get(symbol(node.name))
  }
  function property(value, key, node) {
    key = propertyKey(key, node)
    knownShape(value, node)
    if (value === undefined || value === null) return fail(node, 'missing receiver')
    return value[key]
  }
  function evaluate(node, env = new Map(), active = new Set()) {
    if (!node) return undefined
    if (active.size > 100) return fail(node, 'expression depth exceeded')
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return literal(node)
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isIdentifier(node)) return readIdentifier(node, env, active)
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAwaitExpression(node)
    )
      return evaluate(node.expression, env, active)
    if (ts.isArrayLiteralExpression(node))
      return node.elements.flatMap((child) =>
        ts.isSpreadElement(child)
          ? Array.from(sequenceValue(evaluate(child.expression, env, active), child))
          : [evaluate(child, env, active)],
      )
    if (ts.isObjectLiteralExpression(node)) return object(node, env, active)
    if (ts.isPropertyAccessExpression(node))
      return property(evaluate(node.expression, env, active), node.name.text, node)
    if (ts.isElementAccessExpression(node))
      return property(
        evaluate(node.expression, env, active),
        evaluate(node.argumentExpression, env, active),
        node,
      )
    if (ts.isTemplateExpression(node)) return template(node, env, active)
    if (ts.isBinaryExpression(node)) return binary(node, env, active)
    if (ts.isPrefixUnaryExpression(node)) return unary(node, env, active)
    if (ts.isConditionalExpression(node))
      return evaluate(
        condition(evaluate(node.condition, env, active), node) ? node.whenTrue : node.whenFalse,
        env,
        active,
      )
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      return { functionNode: node, env }
    if (ts.isCallExpression(node)) return call(node, env, active)
    if (ts.isRegularExpressionLiteral(node)) return regex(node)
    return fail(node, 'unsupported expression')
  }
  function literal(node) {
    return ts.isNumericLiteral(node) ? Number(node.text) : node.text
  }
  function regex(node) {
    const text = node.text
    const end = text.lastIndexOf('/')
    return new RegExp(text.slice(1, end), text.slice(end + 1))
  }
  function object(node, env, active) {
    const value = {}
    for (const child of node.properties) applyProperty(value, child, env, active)
    return value
  }
  function applyProperty(value, child, env, active) {
    if (ts.isSpreadAssignment(child))
      return Object.assign(value, knownShape(evaluate(child.expression, env, active), child))
    const key = memberKey(child.name, env, active)
    if (ts.isShorthandPropertyAssignment(child)) {
      value[key] = evaluate(child.name, env, active)
      return
    }
    if (!ts.isPropertyAssignment(child)) return fail(child, 'unsupported member')
    value[key] = evaluate(child.initializer, env, active)
  }
  function template(node, env, active) {
    return (
      node.head.text +
      node.templateSpans
        .map(
          (span) => primitiveText(evaluate(span.expression, env, active), span) + span.literal.text,
        )
        .join('')
    )
  }
  function primitiveValue(value, node) {
    if (
      typeof value === 'symbol' ||
      typeof value === 'function' ||
      (typeof value === 'object' && value !== null)
    )
      return fail(node, 'unsupported primitive conversion')
    return value
  }
  function primitiveText(value, node) {
    return String(primitiveValue(value, node))
  }
  function binary(node, env, active) {
    const left = evaluate(node.left, env, active)
    const op = ts.tokenToString(node.operatorToken.kind)
    if (['&&', '||', '??'].includes(op)) condition(left, node)
    if (op === '&&') return left && evaluate(node.right, env, active)
    if (op === '||') return left || evaluate(node.right, env, active)
    if (op === '??') return left ?? evaluate(node.right, env, active)
    primitiveValue(left, node)
    const right = primitiveValue(evaluate(node.right, env, active), node)
    const operators = {
      '+': () => left + right,
      '-': () => left - right,
      '*': () => left * right,
      '/': () => left / right,
      '%': () => left % right,
      '<': () => left < right,
      '<=': () => left <= right,
      '>': () => left > right,
      '>=': () => left >= right,
      '===': () => left === right,
      '!==': () => left !== right,
      '==': () => left == right,
      '!=': () => left != right,
      '|': () => left | right,
      '&': () => left & right,
      '^': () => left ^ right,
      '>>>': () => left >>> right,
      '>>': () => left >> right,
      '<<': () => left << right,
    }
    if (!operators[op]) return fail(node, `unsupported operator ${op}`)
    return operators[op]()
  }
  function unary(node, env, active) {
    const value = evaluate(node.operand, env, active)
    condition(value, node)
    if (node.operator !== ts.SyntaxKind.ExclamationToken) primitiveValue(value, node)
    if (node.operator === ts.SyntaxKind.MinusToken) return -value
    if (node.operator === ts.SyntaxKind.PlusToken) return +value
    if (node.operator === ts.SyntaxKind.ExclamationToken) return !value
    if (node.operator === ts.SyntaxKind.TildeToken) return ~value
    return fail(node, 'unsupported unary')
  }
  function call(node, env, active) {
    if (ts.isPropertyAccessExpression(node.expression)) return method(node, env, active)
    const fn = evaluate(node.expression, env, active)
    const args = node.arguments.map((arg) => evaluate(arg, env, active))
    if (fn === String) return primitiveText(args[0], node)
    if ([Number, Boolean].includes(fn)) {
      condition(args[0], node)
      if (fn === Number) primitiveValue(args[0], node)
      return fn(...args)
    }
    if (fn?.reviewed) return fn.reviewed(...args)
    if (fn?.functionNode) return invoke(fn, args, active)
    return fail(node, 'unreviewed call')
  }
  function method(node, env, active) {
    const receiver = knownShape(evaluate(node.expression.expression, env, active), node)
    const name = node.expression.name.text
    const args = node.arguments.map((arg) => evaluate(arg, env, active))
    if (
      receiver === Math &&
      ['min', 'max', 'floor', 'ceil', 'trunc', 'abs', 'round', 'imul', 'pow', 'sqrt'].includes(name)
    )
      return Math[name](...knownValue(args, node))
    if (receiver === Object && ['keys', 'values', 'entries'].includes(name))
      return Object[name](...knownValue(args, node))
    if (receiver === Array && name === 'from')
      return Array.from(
        arrayFromSource(args[0], node),
        args[1] === undefined ? undefined : mappingCallback(args[1], node, active),
      )
    if (
      Array.isArray(receiver) &&
      ['map', 'flatMap', 'filter', 'find', 'some', 'every'].includes(name)
    )
      return arrayCallback(receiver, name, args[0], node, active)
    if (Array.isArray(receiver) && name === 'concat')
      return receiver.concat(...args.map((value) => knownShape(value, node)))
    if (Array.isArray(receiver) && name === 'entries') return Array.from(receiver.entries())
    if (name === 'join' && Array.isArray(receiver))
      receiver.forEach((value) => primitiveText(value, node))
    if (['replace', 'replaceAll'].includes(name) && args[1]?.functionNode)
      return fail(node, 'unsupported replacement callback')
    if (Array.isArray(receiver) && ['includes', 'indexOf', 'lastIndexOf'].includes(name))
      knownValue(receiver, node)
    if ((typeof receiver === 'string' || Array.isArray(receiver)) && methods.has(name))
      return receiver[name](...knownValue(args, node))
    return fail(node, `unreviewed method ${name}`)
  }
  function mappingCallback(fn, node, active) {
    if (!fn?.functionNode) return fail(node, 'unsupported mapping callback')
    return (value, index) => invoke(fn, [value, index], active)
  }
  function arrayCallback(receiver, name, fn, node, active) {
    const callback = mappingCallback(fn, node, active)
    return receiver[name]((value, index) => {
      const result = callback(value, index)
      if (name === 'flatMap') knownShape(result, node)
      return ['map', 'flatMap'].includes(name) ? result : condition(result, node)
    })
  }
  function propertyKey(key, node) {
    if (typeof key !== 'string' && typeof key !== 'number')
      return fail(node, 'unknown property key')
    if (forbiddenKeys.has(String(key))) return fail(node, 'forbidden property')
    return key
  }
  function memberKey(key, env, active) {
    if (ts.isComputedPropertyName(key))
      return propertyKey(evaluate(key.expression, env, active), key)
    if (ts.isIdentifier(key) || ts.isStringLiteralLike(key) || ts.isNumericLiteral(key))
      return propertyKey(key.text, key)
    return fail(key, 'unsupported member key')
  }
  function bindingKey(entry, index, env, active) {
    if (ts.isArrayBindingPattern(entry.parent)) return index
    return memberKey(entry.propertyName ?? entry.name, env, active)
  }
  function bindElement(entry, index, value, env, active) {
    if (ts.isOmittedExpression(entry)) return
    if (entry.dotDotDotToken) return fail(entry, 'unsupported rest binding')
    const member = property(value, bindingKey(entry, index, env, active), entry)
    bind(
      entry.name,
      member === undefined ? evaluate(entry.initializer, env, active) : member,
      env,
      active,
    )
  }
  function bind(name, value, env, active = new Set()) {
    if (ts.isIdentifier(name)) {
      env.set(symbol(name), value)
      return
    }
    if (!ts.isArrayBindingPattern(name) && !ts.isObjectBindingPattern(name))
      return fail(name, 'unsupported binding')
    if (ts.isArrayBindingPattern(name) && !Array.isArray(value))
      return fail(name, 'unsupported iterable binding')
    name.elements.forEach((entry, index) => bindElement(entry, index, value, env, active))
  }
  function bindParameter(parameter, value, env, active = new Set()) {
    if (parameter.dotDotDotToken) return fail(parameter, 'unsupported rest parameter')
    bind(
      parameter.name,
      value === undefined ? evaluate(parameter.initializer, env, active) : value,
      env,
      active,
    )
  }
  function invoke(fn, args, active) {
    const node = fn.functionNode
    const env = bindParameters(node, args, fn.env, active)
    if (!ts.isBlock(node.body)) return evaluate(node.body, env, active)
    return statements(node.body.statements, env, active)?.value
  }
  function statements(nodes, env, active) {
    for (const node of nodes) {
      const result = statement(node, env, active)
      if (result?.returned) return result
    }
    return undefined
  }
  function statement(node, env, active) {
    if (!node || ts.isEmptyStatement(node)) return
    if (ts.isReturnStatement(node))
      return { returned: true, value: evaluate(node.expression, env, active) }
    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach((decl) =>
        bind(decl.name, evaluate(decl.initializer, env, active), env),
      )
      return
    }
    if (ts.isExpressionStatement(node)) return fail(node, 'effectful helper statement')
    if (ts.isIfStatement(node))
      return statement(
        condition(evaluate(node.expression, env, active), node)
          ? node.thenStatement
          : node.elseStatement,
        env,
        active,
      )
    if (node && ts.isBlock(node)) {
      return statements(node.statements, env, active)
    }
    if (ts.isThrowStatement(node)) return fail(node, 'reached throw')
    return fail(node, 'unsupported function statement')
  }
  function enclosing(node) {
    const parents = []
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionLike(parent) || ts.isForOfStatement(parent) || ts.isForStatement(parent))
        parents.push(parent)
    }
    return parents.reverse()
  }
  function contexts(node, trail = new Set()) {
    if (trail.has(node)) return fail(node, 'recursive caller')
    const next = new Set(trail).add(node)
    let environments = [new Map()]
    for (const parent of enclosing(node))
      environments = environments.flatMap((env) => expand(parent, env, next))
    if (environments.length > 100000) return fail(node, 'context budget exceeded')
    return environments
  }
  function expand(parent, env, trail) {
    if (ts.isForOfStatement(parent)) return forOf(parent, env)
    if (ts.isForStatement(parent)) return forLoop(parent, env)
    if (!parent.parameters.length) return [env]
    return functionContexts(parent, env, trail)
  }
  function forOf(node, env) {
    const values = finiteRows(node.expression, env)
    const binding = node.initializer.declarations?.[0]?.name ?? node.initializer
    return Array.from(values, (value) => {
      const result = new Map(env)
      bind(binding, value, result)
      return result
    })
  }
  function finiteRows(node, env) {
    try {
      return sequenceValue(evaluate(node, env), node)
    } catch (error) {
      if (!ts.isArrayLiteralExpression(node) || node.elements.some(ts.isSpreadElement)) throw error
      return node.elements.map((child) => opaqueIdentity(child, env))
    }
  }
  function opaqueIdentity(node, env) {
    try {
      return evaluate(node, env)
    } catch (error) {
      if (!(error instanceof Unresolved)) throw error
      return Symbol(error.message)
    }
  }
  function forLoop(node, env) {
    const decl = node.initializer?.declarations?.[0]
    if (!decl || !ts.isIdentifier(decl.name)) return fail(node, 'unsupported loop binding')
    const start = numericValue(evaluate(decl.initializer, env), node)
    const step = numericValue(loopStep(node, env, symbol(decl.name)), node)
    numericIncrementors.add(node.incrementor)
    const result = []
    for (let value = start; result.length < 100000; value += step) {
      const current = new Map(env)
      bind(decl.name, value, current)
      if (!condition(evaluate(node.condition, current), node)) return result
      result.push(current)
    }
    return fail(node, 'unbounded loop')
  }
  function numericValue(value, node) {
    if (typeof value !== 'number' || !Number.isFinite(value))
      return fail(node, 'unsupported numeric loop')
    return value
  }
  function loopStep(node, env, key) {
    const step = unwrap(node.incrementor)
    if (!step) return fail(node, 'missing loop step')
    if (
      ts.isPostfixUnaryExpression(step) &&
      rootSymbol(step.operand) === key &&
      ts.isIdentifier(unwrap(step.operand))
    )
      return step.operator === ts.SyntaxKind.PlusPlusToken ? 1 : -1
    if (
      ts.isBinaryExpression(step) &&
      step.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
      ts.isIdentifier(unwrap(step.left)) &&
      rootSymbol(step.left) === key
    )
      return evaluate(step.right, env)
    return fail(node, 'unsupported loop step')
  }
  function functionContexts(node, env, trail) {
    if (ts.isFunctionDeclaration(node)) return callerContexts(node, env, trail)
    const parent = node.parent
    if (!ts.isCallExpression(parent)) return fail(node, 'unbound callback')
    const fn = parent.expression
    if (
      ts.isCallExpression(fn) &&
      ts.isPropertyAccessExpression(fn.expression) &&
      ['each', 'for'].includes(fn.expression.name.text)
    )
      return testRows(node, fn, env)
    if (
      ts.isPropertyAccessExpression(fn) &&
      ['map', 'flatMap', 'filter', 'find', 'some', 'every', 'forEach'].includes(fn.name.text)
    )
      return callbackRows(node, evaluate(fn.expression, env), env)
    return fail(node, 'unbound callback domain')
  }
  function testRows(node, call, env) {
    const values = finiteRows(call.arguments[0], env)
    const rows = Array.from(values, (value) =>
      Array.isArray(value) && call.expression.name.text === 'each' ? value : [value],
    )
    return rows.map((args) => bindParameters(node, args, env))
  }
  function callbackRows(node, values, env) {
    return Array.from(sequenceValue(values, node), (value, index) =>
      bindParameters(node, [value, index], env),
    )
  }
  function bindParameters(node, args, env, active = new Set()) {
    const result = new Map(env)
    node.parameters.forEach((parameter, index) =>
      bindParameter(parameter, args[index], result, active),
    )
    return result
  }
  function callerContexts(node, env, trail) {
    const callers = (calls.get(node.name.text) ?? []).filter(
      (call) => symbol(call.expression) === symbol(node.name),
    )
    if (!callers.length) return fail(node, `no finite callers of ${node.name.text}`)
    return callers.flatMap((call) =>
      contexts(call, trail).map((context) => parametersAtCall(node, call, env, context)),
    )
  }
  function parametersAtCall(node, call, env, context) {
    const result = new Map(env)
    node.parameters.forEach((parameter, index) =>
      bindArgument(parameter, call.arguments[index], result, context),
    )
    return result
  }
  function bindArgument(parameter, argument, result, context) {
    try {
      bindParameter(parameter, evaluate(argument, context), result)
    } catch (error) {
      if (!(error instanceof Unresolved)) throw error
    }
  }
  function condition(value, node) {
    if (typeof value === 'symbol') return fail(node, 'unknown condition')
    return value
  }
  function knownShape(value, node) {
    if (typeof value === 'symbol') return fail(node, 'unknown shape')
    if (value?.functionNode) return fail(node, 'unevaluated function shape')
    return value
  }
  function arrayFromSource(value, node) {
    knownShape(value, node)
    if (Array.isArray(value) || typeof value === 'string') return value
    if (
      value &&
      typeof value === 'object' &&
      Object.hasOwn(value, 'length') &&
      Number.isSafeInteger(value.length) &&
      value.length >= 0
    )
      return value
    return fail(node, 'unsupported array-like source')
  }
  function sequenceValue(value, node) {
    knownShape(value, node)
    if (!Array.isArray(value) && typeof value !== 'string')
      return fail(node, 'unsupported sequence')
    return value
  }
  function knownValue(value, node) {
    if (typeof value === 'symbol') return fail(node, 'unknown value')
    if (value?.functionNode) return fail(node, 'unevaluated function')
    if (value && typeof value === 'object')
      Object.values(value).forEach((entry) => knownValue(entry, node))
    return value
  }
  function resolve(node) {
    try {
      return { values: [knownValue(evaluate(node), node)], failures: [], contexts: 1 }
    } catch {
      /* Finite caller bindings may resolve the expression. */
    }
    const values = []
    const failures = new Set()
    let environments
    try {
      environments = contexts(node)
    } catch (error) {
      return { values, failures: [error.message], contexts: 0 }
    }
    for (const env of environments) resolveOne(node, env, values, failures)
    return { values, failures: Array.from(failures).sort(), contexts: environments.length }
  }
  function resolveOne(node, env, values, failures) {
    try {
      values.push(knownValue(evaluate(node, env), node))
    } catch (error) {
      failures.add(error.message)
    }
  }
  return { files, resolve, location, declaration, nameOf, identifiers, evaluate }
}

function append(map, key, value) {
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(value)
}
