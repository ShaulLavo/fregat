import type { KeyContext } from './key-context'

/** Zed's context predicate language, parsed. */
export type ContextPredicate =
  | { readonly kind: 'identifier'; readonly name: string }
  | { readonly kind: 'equal'; readonly key: string; readonly value: string }
  | { readonly kind: 'not-equal'; readonly key: string; readonly value: string }
  | {
      readonly kind: 'descendant'
      readonly parent: ContextPredicate
      readonly child: ContextPredicate
    }
  | { readonly kind: 'not'; readonly predicate: ContextPredicate }
  | { readonly kind: 'and'; readonly left: ContextPredicate; readonly right: ContextPredicate }
  | { readonly kind: 'or'; readonly left: ContextPredicate; readonly right: ContextPredicate }

const PRECEDENCE_CHILD = 1
const PRECEDENCE_OR = 2
const PRECEDENCE_AND = 3
const PRECEDENCE_EQ = 4
const PRECEDENCE_NOT = 5
const IDENTIFIER = /[\p{L}\p{N}_-]+/uy

type Operator = {
  readonly token: string
  readonly precedence: number
  readonly build: (left: ContextPredicate, right: ContextPredicate) => ContextPredicate
}
const OPERATORS: readonly Operator[] = [
  {
    token: '>',
    precedence: PRECEDENCE_CHILD,
    build: (parent, child) => ({ kind: 'descendant', parent, child }),
  },
  {
    token: '&&',
    precedence: PRECEDENCE_AND,
    build: (left, right) => ({ kind: 'and', left, right }),
  },
  { token: '||', precedence: PRECEDENCE_OR, build: (left, right) => ({ kind: 'or', left, right }) },
  {
    token: '==',
    precedence: PRECEDENCE_EQ,
    build: (left, right) => equality('equal', left, right),
  },
  {
    token: '!=',
    precedence: PRECEDENCE_EQ,
    build: (left, right) => equality('not-equal', left, right),
  },
]

/**
 * Parses a predicate such as `Editor && extension == md` or `Workspace > !Terminal`.
 * Operators, loosest first: `>`, `||`, `&&`, `==`/`!=`, prefix `!`; parentheses group.
 */
export function parseContextPredicate(source: string): ContextPredicate {
  const parser = { source, index: 0 }
  skip(parser)
  const predicate = parseExpression(parser, 0)
  if (parser.index < source.length)
    throw new SyntaxError(
      `Unexpected character ${JSON.stringify(source[parser.index])} in context predicate`,
    )
  return predicate
}

type Parser = { readonly source: string; index: number }

function parseExpression(parser: Parser, minPrecedence: number): ContextPredicate {
  let predicate = parsePrimary(parser)
  for (;;) {
    const operator = OPERATORS.find(
      (candidate) =>
        candidate.precedence >= minPrecedence &&
        parser.source.startsWith(candidate.token, parser.index),
    )
    if (!operator) return predicate
    parser.index += operator.token.length
    skip(parser)
    predicate = operator.build(predicate, parseExpression(parser, operator.precedence + 1))
  }
}

function parsePrimary(parser: Parser): ContextPredicate {
  const next = parser.source[parser.index]
  if (next === undefined) throw new SyntaxError('Unexpected end of context predicate')
  if (next === '(') {
    parser.index += 1
    skip(parser)
    const predicate = parseExpression(parser, 0)
    if (parser.source[parser.index] !== ')')
      throw new SyntaxError("Expected ')' in context predicate")
    parser.index += 1
    skip(parser)
    return predicate
  }
  if (next === '!') {
    parser.index += 1
    skip(parser)
    return { kind: 'not', predicate: parseExpression(parser, PRECEDENCE_NOT) }
  }
  IDENTIFIER.lastIndex = parser.index
  const match = IDENTIFIER.exec(parser.source)
  if (!match)
    throw new SyntaxError(`Unexpected character ${JSON.stringify(next)} in context predicate`)
  parser.index = IDENTIFIER.lastIndex
  skip(parser)
  return { kind: 'identifier', name: match[0] }
}

function equality(
  kind: 'equal' | 'not-equal',
  left: ContextPredicate,
  right: ContextPredicate,
): ContextPredicate {
  if (left.kind !== 'identifier' || right.kind !== 'identifier')
    throw new SyntaxError('Operands of == and != must be identifiers')
  return { kind, key: left.name, value: right.name }
}

function skip(parser: Parser) {
  while (parser.index < parser.source.length && /\s/.test(parser.source[parser.index]!))
    parser.index += 1
}

/** True when the predicate matches the stack, ordered root first. */
export function evaluatePredicate(
  predicate: ContextPredicate,
  stack: readonly KeyContext[],
): boolean {
  return evaluate(predicate, stack.length, stack, stack)
}

/**
 * The deepest stack depth at which the predicate matches, or null. A binding without a
 * predicate matches at the full depth, so it ranks with the focused context.
 */
export function predicateDepth(
  predicate: ContextPredicate | undefined,
  stack: readonly KeyContext[],
): number | null {
  if (!predicate) return stack.length
  for (let depth = stack.length; depth >= 0; depth -= 1) {
    if (evaluate(predicate, depth, stack, stack)) return depth
  }
  return null
}

// Evaluates against contexts[0, end), whose last entry is the innermost; `!` scans all of `all`.
function evaluate(
  predicate: ContextPredicate,
  end: number,
  contexts: readonly KeyContext[],
  all: readonly KeyContext[],
): boolean {
  if (end <= 0) return false
  const context = contexts[end - 1]!
  switch (predicate.kind) {
    case 'identifier':
      return context.identifiers.has(predicate.name)
    case 'equal':
      return context.values.get(predicate.key) === predicate.value
    case 'not-equal': {
      const value = context.values.get(predicate.key)
      return value === undefined || value !== predicate.value
    }
    case 'not':
      return !anyPrefixMatches(predicate.predicate, all)
    case 'and':
      return (
        evaluate(predicate.left, end, contexts, all) &&
        evaluate(predicate.right, end, contexts, all)
      )
    case 'or':
      return (
        evaluate(predicate.left, end, contexts, all) ||
        evaluate(predicate.right, end, contexts, all)
      )
    case 'descendant':
      return descendantMatches(predicate, end, contexts, all)
  }
}

function anyPrefixMatches(predicate: ContextPredicate, all: readonly KeyContext[]): boolean {
  for (let end = 1; end <= all.length; end += 1) {
    if (evaluate(predicate, end, all, all)) return true
  }
  return false
}

function descendantMatches(
  predicate: Extract<ContextPredicate, { kind: 'descendant' }>,
  end: number,
  contexts: readonly KeyContext[],
  all: readonly KeyContext[],
): boolean {
  // The first ancestor matching the parent decides: the child must match the stack below it.
  for (let split = 1; split < end; split += 1) {
    if (!evaluate(predicate.parent, split, contexts, all)) continue
    const below = contexts.slice(split, end)
    return evaluate(predicate.child, below.length, below, below)
  }
  return false
}
