import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-api'

const root = fileURLToPath(new URL('../../', import.meta.url))
const allocatingMethods = new Set([
  'map',
  'filter',
  'flatMap',
  'slice',
  'concat',
  'flat',
  'toSorted',
  'toReversed',
  'toSpliced',
  'with',
])
const allocatingAfterCopy = new Set(['map', 'filter', 'flatMap'])
const copyingMethods = new Set(['toSorted', 'toReversed', 'toSpliced', 'with'])
const mutatingOrderMethods = new Map([
  ['sort', 'toSorted'],
  ['reverse', 'toReversed'],
])
const excluded =
  /(?:^|\/)(?:node_modules|dist|build|generated|vendor|references|\.git|\.turbo|coverage)\//

export function firstPartyFiles(directory = root) {
  return Array.from(
    new Set(
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: directory,
        encoding: 'utf8',
      }).split('\0'),
    ),
  ).filter(
    (file) =>
      /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file) &&
      !/\.d\.[cm]?ts$/.test(file) &&
      !excluded.test(file) &&
      existsSync(path.join(directory, file)),
  )
}

function unwrap(node) {
  if (!node) return null
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression
  return node
}

function methodCall(node) {
  node = unwrap(node)
  if (!node || !ts.isCallExpression(node)) return null
  const access = unwrap(node.expression)
  if (ts.isPropertyAccessExpression(access))
    return { receiver: unwrap(access.expression), name: access.name.text, node }
  if (!ts.isElementAccessExpression(access)) return null
  const property = access.argumentExpression
  if (!ts.isStringLiteralLike(property)) return null
  return { receiver: unwrap(access.expression), name: property.text, node }
}

function singleSpread(node) {
  node = unwrap(node)
  if (!ts.isArrayLiteralExpression(node) || node.elements.length !== 1) return null
  const element = node.elements[0]
  return ts.isSpreadElement(element) ? unwrap(element.expression) : null
}

export function arrayCandidates(sourceFile) {
  const candidates = []
  function visit(node) {
    if (ts.isArrayLiteralExpression(node)) {
      const spreads = node.elements.filter(ts.isSpreadElement)
      if (spreads.length) candidates.push({ node, spreads })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return candidates
}

function arrayType(checker, node) {
  const type = checker.getTypeAtLocation(node)
  function everyArray(part) {
    if (part.isUnion()) return part.types.every(everyArray)
    if (part.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(part)
      return constraint ? everyArray(constraint) : false
    }
    if (part.isIntersection()) return part.types.some(everyArray)
    return checker.isArrayType(part) || checker.isTupleType(part)
  }
  return everyArray(checker.getApparentType(type))
}

function globalArrayFrom(call, checker) {
  if (call?.name !== 'from' || !ts.isIdentifier(call.receiver) || call.receiver.text !== 'Array')
    return false
  const symbol = checker.getSymbolAtLocation(call.receiver)
  return (
    symbol?.declarations?.some(
      (declaration) =>
        path.dirname(declaration.getSourceFile().fileName) ===
        path.dirname(ts.getDefaultLibFilePath({})),
    ) ?? false
  )
}

function freshArray(node, checker) {
  node = unwrap(node)
  if (!node) return false
  if (ts.isArrayLiteralExpression(node)) return true
  const call = methodCall(node)
  if (globalArrayFrom(call, checker)) return true
  return call && allocatingMethods.has(call.name) && arrayType(checker, call.receiver)
}

function outerCall(node) {
  let expression = node
  while (
    expression.parent?.expression === expression &&
    unwrap(expression.parent) !== expression.parent
  )
    expression = expression.parent
  return methodCall(expression.parent?.parent ?? expression)
}

function copiedAllocation(node, checker) {
  const call = outerCall(node)
  if (!call || !allocatingAfterCopy.has(call.name) || call.receiver !== node) return false
  const source = singleSpread(node)
  return source && arrayType(checker, source)
}

export function checkArrayCandidates(sourceFile, checker) {
  return arrayCandidates(sourceFile).flatMap(({ node, spreads }) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    const finding = (rule, message) => [{ line, rule, message }]
    if (spreads.length >= 2)
      return finding(
        'array-concat',
        'Combine arrays with concat; use Array.from for iterable conversion or densification.',
      )
    const source = singleSpread(node)
    if (source && freshArray(source, checker))
      return finding(
        'redundant-array-copy',
        'Use the direct result for dense arrays; use Array.from to explicitly densify sparse arrays.',
      )
    if (source && copiedAllocation(node, checker))
      return finding(
        'copy-before-allocation',
        'Call the allocating method directly for dense input; use Array.from to explicitly densify sparse input first.',
      )
    return []
  })
}

export function allocationCopyCandidates(sourceFile) {
  const candidates = []
  function visit(node) {
    const call = methodCall(node)
    if (call?.node === node) {
      const inner = methodCall(call.receiver)
      if (call.name === 'from' && methodCall(call.node.arguments[0])) candidates.push(call)
      if (copyingMethods.has(call.name) && (inner || ts.isArrayLiteralExpression(call.receiver)))
        candidates.push(call)
      if (
        allocatingAfterCopy.has(call.name) &&
        inner &&
        (inner.name === 'from' ||
          (['slice', 'concat'].includes(inner.name) && !inner.node.arguments.length))
      )
        candidates.push(call)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return candidates
}

function denseFreshArray(node, checker) {
  node = unwrap(node)
  if (ts.isArrayLiteralExpression(node))
    return node.elements.every((element) => !ts.isOmittedExpression(element))
  const call = methodCall(node)
  if (globalArrayFrom(call, checker)) return true
  return (
    call &&
    ['filter', 'flatMap', 'flat', 'toSorted', 'toReversed', 'toSpliced', 'with'].includes(
      call.name,
    ) &&
    arrayType(checker, call.receiver)
  )
}

export function inspectAllocationCopies(sourceFile, checker) {
  return allocationCopyCandidates(sourceFile).flatMap((call) => {
    const line = sourceFile.getLineAndCharacterOfPosition(call.node.getStart(sourceFile)).line + 1
    const text = call.node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 240)
    const inner = methodCall(call.receiver)
    if (copyingMethods.has(call.name) && freshArray(call.receiver, checker)) {
      const access = unwrap(call.node.expression)
      const mutableMethod = call.name === 'toSorted' ? 'sort' : 'reverse'
      const mutable = checker.getPropertyOfType(
        checker.getTypeAtLocation(access.expression),
        mutableMethod,
      )
      const redundant =
        ['toSorted', 'toReversed'].includes(call.name) &&
        Boolean(mutable) &&
        denseFreshArray(call.receiver, checker)
      return [{ line, text, redundant, rule: 'copy-owned-array' }]
    }
    if (globalArrayFrom(call, checker)) {
      const argument = unwrap(call.node.arguments[0])
      const allocator = methodCall(argument)
      if (!freshArray(argument, checker)) return []
      const dense =
        call.node.arguments.length === 1 &&
        (globalArrayFrom(allocator, checker) || ['filter', 'flatMap'].includes(allocator.name))
      return [{ line, text, redundant: dense, rule: 'copy-fresh-array-from' }]
    }
    if (!allocatingAfterCopy.has(call.name) || !inner) return []
    if (
      globalArrayFrom(inner, checker) &&
      inner.node.arguments[0] &&
      arrayType(checker, inner.node.arguments[0])
    )
      return [{ line, text, redundant: false, rule: 'copy-before-array-from-allocation' }]
    if (!['slice', 'concat'].includes(inner.name) || !arrayType(checker, inner.receiver)) return []
    return [{ line, text, redundant: true, rule: 'copy-before-array-method-allocation' }]
  })
}

export function mutationCopyCandidates(sourceFile) {
  const candidates = []
  function visit(node) {
    const call = methodCall(node)
    if (call?.node === node && mutatingOrderMethods.has(call.name)) {
      const source = singleSpread(call.receiver)
      const conversion = methodCall(call.receiver)
      if (source || conversion?.name === 'from') candidates.push({ call, source, conversion })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return candidates
}

export function inspectMutationCopies(sourceFile, checker) {
  return mutationCopyCandidates(sourceFile).flatMap(({ call, source, conversion }) => {
    if (!source && globalArrayFrom(conversion, checker))
      source = unwrap(conversion.node.arguments[0])
    if (!source) return []
    const ordinaryArray = arrayType(checker, source)
    const sourceType = checker.getTypeAtLocation(source)
    const canMutate = Boolean(checker.getPropertyOfType(sourceType, call.name))
    const mapped = conversion && conversion.node.arguments.length !== 1
    const requiresChange = ordinaryArray && !mapped
    const ownedDense =
      requiresChange && canMutate && freshArray(source, checker) && denseFreshArray(source, checker)
    const immutableMethod = mutatingOrderMethods.get(call.name)
    const start = call.node.getStart(sourceFile)
    const end = call.node.end
    const argumentText = sourceFile.text.slice(call.node.arguments.pos, call.node.arguments.end)
    return [
      {
        line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
        start,
        end,
        original: sourceFile.text.slice(start, end),
        replacement: ownedDense
          ? `(${source.getText(sourceFile)}).${call.name}(${argumentText})`
          : null,
        inPlaceReplacement:
          requiresChange && canMutate
            ? `(${source.getText(sourceFile)}).${call.name}(${argumentText})`
            : null,
        preserveInputReplacement: requiresChange
          ? `(${source.getText(sourceFile)}).${immutableMethod}(${argumentText})`
          : null,
        ordinaryArray,
        sourceType: checker.typeToString(sourceType),
        canMutate,
        requiresChange,
        retainedConversion: !requiresChange,
        ownershipReview: requiresChange && !ownedDense,
        densificationReview: requiresChange && !denseFreshArray(source, checker),
        rule: 'copy-before-ordering',
        message: ownedDense
          ? 'Sort or reverse the fresh owned array directly.'
          : 'Sort or reverse owned arrays in place; use toSorted or toReversed to preserve the input.',
      },
    ]
  })
}

export function inspectMutationSnapshots(sourceFile, checker) {
  const snapshots = []
  function inspect(node, source) {
    const call = methodCall(source)
    if (!call || !mutatingOrderMethods.has(call.name)) return
    const start = node.getStart(sourceFile)
    snapshots.push({
      line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
      start,
      end: node.end,
      original: node.getText(sourceFile),
      replacement: null,
      ordinaryArray: arrayType(checker, call.receiver),
      rule: 'snapshot-after-mutation',
    })
  }
  for (const { node } of arrayCandidates(sourceFile)) inspect(node, singleSpread(node))
  for (const call of allocationCopyCandidates(sourceFile)) {
    if (globalArrayFrom(call, checker)) inspect(call.node, call.node.arguments[0])
  }
  return snapshots
}

export function immutableOrderingCandidates(sourceFile) {
  const calls = []
  function visit(node) {
    const call = methodCall(node)
    if (call?.node === node && ['toSorted', 'toReversed'].includes(call.name)) calls.push(call)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return calls
}

export function inspectImmutableOrdering(sourceFile, checker) {
  return immutableOrderingCandidates(sourceFile).map((call) => {
    const start = call.node.getStart(sourceFile)
    const ordinaryArray = arrayType(checker, call.receiver)
    const mutableMethod = call.name === 'toSorted' ? 'sort' : 'reverse'
    const access = unwrap(call.node.expression)
    const mutable = checker.getPropertyOfType(
      checker.getTypeAtLocation(access.expression),
      mutableMethod,
    )
    const argumentText = sourceFile.text.slice(call.node.arguments.pos, call.node.arguments.end)
    const ownedDense = freshArray(call.receiver, checker) && denseFreshArray(call.receiver, checker)
    const inPlaceReplacement =
      ordinaryArray && mutable
        ? `(${call.receiver.getText(sourceFile)}).${mutableMethod}(${argumentText})`
        : null
    return {
      line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
      start,
      end: call.node.end,
      original: call.node.getText(sourceFile),
      method: call.name,
      ordinaryArray,
      sourceType: checker.typeToString(checker.getTypeAtLocation(access.expression)),
      canMutate: Boolean(mutable),
      form: 'immutable-ordering',
      replacement: ownedDense ? inPlaceReplacement : null,
      inPlaceReplacement,
      ownershipReview: !ownedDense,
      densificationReview: !denseFreshArray(call.receiver, checker),
    }
  })
}

function needsTypeEvidence({ node, spreads }) {
  if (spreads.length !== 1 || node.elements.length !== 1) return false
  const source = singleSpread(node)
  return Boolean(
    methodCall(source) ||
    ts.isArrayLiteralExpression(source) ||
    allocatingAfterCopy.has(outerCall(node)?.name) ||
    mutatingOrderMethods.has(outerCall(node)?.name),
  )
}

function referencedConfigs(config) {
  const loaded = ts.readConfigFile(config, ts.sys.readFile)
  return (loaded.config?.references ?? []).map((reference) => {
    const candidate = path.resolve(path.dirname(config), reference.path)
    const referenceConfig = candidate.endsWith('.json')
      ? candidate
      : path.join(candidate, 'tsconfig.json')
    const referenced = ts.readConfigFile(referenceConfig, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(
      referenced.config ?? {},
      ts.sys,
      path.dirname(referenceConfig),
    )
    return { config: referenceConfig, files: new Set(parsed.fileNames) }
  })
}

function configFor(filename, directory, cache) {
  const config =
    ts.findConfigFile(path.dirname(filename), existsSync) ?? path.join(directory, 'tsconfig.json')
  const references = cache.get(config) ?? referencedConfigs(config)
  cache.set(config, references)
  return references.find((reference) => reference.files.has(filename))?.config ?? config
}

function compilerOptions(config, fullTypes) {
  const loaded = ts.readConfigFile(config, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(loaded.config ?? {}, ts.sys, path.dirname(config))
  // The fast gate proves local array types; --full-types follows imported types for audits.
  return {
    ...parsed.options,
    allowJs: true,
    checkJs: true,
    noEmit: true,
    ...(fullTypes ? {} : { noResolve: true, types: [] }),
  }
}

function inspectGroup(config, group, fullTypes) {
  const program = ts.createProgram(
    group.map((entry) => entry.absolute),
    compilerOptions(config, fullTypes),
  )
  const checker = program.getTypeChecker()
  const findings = []
  const adjacentCopies = []
  const mutationCopies = []
  const mutationSnapshots = []
  const immutableOrdering = []
  for (const { file, absolute } of group) {
    const source = program.getSourceFile(absolute)
    immutableOrdering.push(
      ...inspectImmutableOrdering(source, checker).map((ordering) => ({ file, ...ordering })),
    )
    const ordering = inspectMutationCopies(source, checker)
    mutationCopies.push(...ordering.map((copy) => ({ file, ...copy })))
    findings.push(
      ...ordering
        .filter((finding) => finding.requiresChange)
        .map((finding) => ({ file, ...finding })),
    )
    mutationSnapshots.push(
      ...inspectMutationSnapshots(source, checker).map((snapshot) => ({ file, ...snapshot })),
    )
    const copies = inspectAllocationCopies(source, checker)
    adjacentCopies.push(...copies.map((copy) => ({ file, ...copy })))
    for (const { line, rule, redundant } of copies) {
      if (!redundant) continue
      findings.push({
        file,
        line,
        rule,
        message:
          rule === 'copy-owned-array'
            ? 'Sort or reverse the fresh owned array in place.'
            : 'Use the allocating array operation directly.',
      })
    }
    for (const finding of checkArrayCandidates(source, checker)) {
      if (finding.rule === 'array-concat') continue
      findings.push({ file, ...finding })
    }
  }
  return { findings, adjacentCopies, mutationCopies, mutationSnapshots, immutableOrdering }
}

export function inspectFiles(
  files,
  directory = root,
  { inventory = false, fullTypes = false } = {},
) {
  const groups = new Map()
  const configs = new Map()
  const entries = []
  const findings = []
  const adjacentCopies = []
  const mutationCopies = []
  const mutationSnapshots = []
  const immutableOrdering = []
  for (const file of files) {
    const absolute = path.join(directory, file)
    const source = ts.createSourceFile(
      absolute,
      readFileSync(absolute, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const candidates = arrayCandidates(source)
    const allocationCopies = allocationCopyCandidates(source)
    const orderingCopies = mutationCopyCandidates(source)
    const immutableCalls = immutableOrderingCandidates(source)
    if (
      !candidates.length &&
      !allocationCopies.length &&
      !orderingCopies.length &&
      !immutableCalls.length
    )
      continue
    if (inventory)
      entries.push({
        file,
        spreads: candidates.map(({ node, spreads }) => ({
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          count: spreads.length,
          text: node.getText(source).replace(/\s+/g, ' ').slice(0, 240),
        })),
      })
    for (const { node, spreads } of candidates) {
      if (spreads.length < 2) continue
      findings.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        rule: 'array-concat',
        message:
          'Combine arrays with concat; use Array.from for iterable conversion or densification.',
      })
    }
    if (
      !candidates.some(needsTypeEvidence) &&
      !allocationCopies.length &&
      !orderingCopies.length &&
      !immutableCalls.length
    )
      continue
    const config = configFor(absolute, directory, configs)
    const group = groups.get(config) ?? []
    group.push({ file, absolute })
    groups.set(config, group)
  }
  for (const [config, group] of groups) {
    const result = inspectGroup(config, group, fullTypes)
    findings.push(...result.findings)
    adjacentCopies.push(...result.adjacentCopies)
    mutationCopies.push(...result.mutationCopies)
    mutationSnapshots.push(...result.mutationSnapshots)
    immutableOrdering.push(...result.immutableOrdering)
  }
  return {
    findings,
    inventory: entries,
    adjacentCopies,
    mutationCopies,
    mutationSnapshots,
    immutableOrdering,
  }
}

function main() {
  const args = process.argv.slice(2)
  const inventory = args.includes('--inventory')
  const fullTypes = args.includes('--full-types')
  const files = args.filter((arg) => !arg.startsWith('--'))
  const result = inspectFiles(files.length ? files : firstPartyFiles(), root, {
    inventory,
    fullTypes,
  })
  if (inventory) return console.log(JSON.stringify(result, null, 2))
  if (!result.findings.length)
    return console.log('array construction gate: no redundant copies or array spread concatenation')
  for (const { file, line, rule, message } of result.findings)
    console.error(`${file}:${line}: ${rule}: ${message}`)
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
