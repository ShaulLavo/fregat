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
  const changed = new Set()
  const aliases = []
  for (const sf of files.values()) index(sf)
  for (let pass = 0; pass < aliases.length; pass += 1) propagateWrites()

  function index(node) {
    if (ts.isCallExpression(node)) append(calls, nameOf(node.expression), node)
    if (ts.isIdentifier(node)) append(identifiers, node.text, node)
    indexWrites(node)
    ts.forEachChild(node, index)
  }
  function rootSymbol(node) {
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
      changed.add(rootSymbol(node.left))
    if (
      (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
    )
      changed.add(rootSymbol(node.operand))
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
      changed.add(rootSymbol(node.expression.expression))
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer)
    )
      aliases.push([symbol(node.name), symbol(node.initializer)])
  }
  function propagateWrites() {
    for (const [left, right] of aliases) {
      if (!changed.has(left) && !changed.has(right)) continue
      changed.add(left)
      changed.add(right)
    }
  }
  function symbol(node) {
    if (node.parent && ts.isShorthandPropertyAssignment(node.parent))
      return checker.getShorthandAssignmentValueSymbol(node.parent)
    return checker.getSymbolAtLocation(node)
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
    if (env.has(key)) return env.get(key)
    if (key && changed.has(key)) return fail(node, `mutable binding ${node.text}`)
    const declared = declaration(node)
    if (!declared && Object.hasOwn(globals, node.text)) return globals[node.text]
    if (!declared) return fail(node, `unbound ${node.text}`)
    if (ts.isImportSpecifier(declared) || ts.isImportClause(declared)) return readImport(declared)
    if (ts.isFunctionDeclaration(declared)) return { functionNode: declared, env }
    if (ts.isBindingElement(declared)) return readBinding(declared, env, active)
    if (!ts.isVariableDeclaration(declared)) return fail(node, `unbound parameter ${node.text}`)
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
    const parent = node.parent.parent
    if (!ts.isVariableDeclaration(parent)) return fail(node, 'unbound destructuring')
    const value = evaluate(parent.initializer, env, active)
    const key = ts.isArrayBindingPattern(node.parent)
      ? node.parent.elements.indexOf(node)
      : (node.propertyName ?? node.name).getText()
    return value[key]
  }
  function property(value, key, node) {
    if (forbiddenKeys.has(key)) return fail(node, 'forbidden property')
    if (typeof value === 'symbol') return fail(node, 'unreviewed receiver')
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
          ? evaluate(child.expression, env, active)
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
      return Object.assign(value, evaluate(child.expression, env, active))
    const key = child.name?.text ?? child.name?.getText()
    if (forbiddenKeys.has(key)) return fail(child, 'forbidden key')
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
  function primitiveText(value, node) {
    if (typeof value === 'symbol' || (typeof value === 'object' && value !== null))
      return fail(node, 'unknown string conversion')
    return String(value)
  }
  function binary(node, env, active) {
    const left = evaluate(node.left, env, active)
    const op = ts.tokenToString(node.operatorToken.kind)
    if (['&&', '||', '??'].includes(op)) condition(left, node)
    if (op === '&&') return left && evaluate(node.right, env, active)
    if (op === '||') return left || evaluate(node.right, env, active)
    if (op === '??') return left ?? evaluate(node.right, env, active)
    const right = evaluate(node.right, env, active)
    if (typeof left === 'symbol' || typeof right === 'symbol')
      return fail(node, 'unknown binary operand')
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
      return fn(...args)
    }
    if (fn?.reviewed) return fn.reviewed(...args)
    if (fn?.functionNode) return invoke(fn, args, active)
    return fail(node, 'unreviewed call')
  }
  function method(node, env, active) {
    const receiver = evaluate(node.expression.expression, env, active)
    const name = node.expression.name.text
    const args = node.arguments.map((arg) => evaluate(arg, env, active))
    if (
      receiver === Math &&
      ['min', 'max', 'floor', 'ceil', 'trunc', 'abs', 'round', 'imul', 'pow', 'sqrt'].includes(name)
    )
      return Math[name](...args)
    if (receiver === Object && ['keys', 'values', 'entries'].includes(name))
      return Object[name](...args)
    if (receiver === Array && name === 'from')
      return Array.from(
        args[0],
        args[1] ? (value, index) => invoke(args[1], [value, index], active) : undefined,
      )
    if (
      Array.isArray(receiver) &&
      ['map', 'flatMap', 'filter', 'find', 'some', 'every'].includes(name)
    )
      return receiver[name]((value, index) => invoke(args[0], [value, index], active))
    if (Array.isArray(receiver) && name === 'entries') return Array.from(receiver.entries())
    if (name === 'join' && Array.isArray(receiver))
      receiver.forEach((value) => primitiveText(value, node))
    if (['replace', 'replaceAll'].includes(name) && args[1]?.functionNode)
      return fail(node, 'unsupported replacement callback')
    if ((typeof receiver === 'string' || Array.isArray(receiver)) && methods.has(name))
      return receiver[name](...args)
    return fail(node, `unreviewed method ${name}`)
  }
  function bind(name, value, env) {
    if (ts.isIdentifier(name)) {
      env.set(symbol(name), value)
      return
    }
    if (ts.isArrayBindingPattern(name)) {
      name.elements.forEach((entry, index) => bind(entry.name, value?.[index], env))
      return
    }
    if (ts.isObjectBindingPattern(name)) {
      name.elements.forEach((entry) =>
        bind(entry.name, value?.[(entry.propertyName ?? entry.name).text], env),
      )
      return
    }
    return fail(name, 'unsupported binding')
  }
  function invoke(fn, args, active) {
    const node = fn.functionNode
    const env = new Map(fn.env)
    node.parameters.forEach((parameter, index) =>
      bind(
        parameter.name,
        args[index] === undefined ? evaluate(parameter.initializer, env, active) : args[index],
        env,
      ),
    )
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
      return evaluate(node, env)
    } catch (error) {
      if (!ts.isArrayLiteralExpression(node)) throw error
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
    const start = evaluate(decl.initializer, env)
    const result = []
    for (let value = start; result.length < 100000; value += loopStep(node, env)) {
      const current = new Map(env)
      bind(decl.name, value, current)
      if (!evaluate(node.condition, current)) return result
      result.push(current)
    }
    return fail(node, 'unbounded loop')
  }
  function loopStep(node, env) {
    const step = node.incrementor
    if (ts.isPostfixUnaryExpression(step))
      return step.operator === ts.SyntaxKind.PlusPlusToken ? 1 : -1
    if (ts.isBinaryExpression(step) && step.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)
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
    return Array.from(values, (value, index) => bindParameters(node, [value, index], env))
  }
  function bindParameters(node, args, env) {
    const result = new Map(env)
    node.parameters.forEach((parameter, index) => bind(parameter.name, args[index], result))
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
      bind(parameter.name, evaluate(argument ?? parameter.initializer, context), result)
    } catch (error) {
      if (!(error instanceof Unresolved)) throw error
    }
  }
  function condition(value, node) {
    if (typeof value === 'symbol') return fail(node, 'unknown condition')
    return value
  }
  function resolve(node) {
    try {
      return { values: [evaluate(node)], failures: [], contexts: 1 }
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
      values.push(evaluate(node, env))
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
