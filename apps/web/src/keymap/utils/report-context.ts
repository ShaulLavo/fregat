import {
  createKeyContext,
  parseContextPredicate,
  type ContextPredicate,
  type KeyContext,
} from '@fregat/hotkeys'

type ContextSeed = { identifiers: readonly string[]; values: Readonly<Record<string, string>> }
type ContextPath = readonly ContextSeed[]
const empty: ContextSeed = { identifiers: [], values: {} }
const workspacePath: ContextPath = [{ identifiers: ['Workspace'], values: {} }]

export function reportContextPaths(source: string | undefined): readonly (readonly KeyContext[])[] {
  const paths = source ? predicatePaths(parseContextPredicate(source)) : [[empty]]
  return paths.map((path) => {
    const seeds = path[0]?.identifiers.includes('Workspace') ? path : workspacePath.concat(path)
    return seeds.map((seed) => createKeyContext(seed))
  })
}

function predicatePaths(predicate: ContextPredicate): readonly ContextPath[] {
  switch (predicate.kind) {
    case 'identifier':
      return [[{ identifiers: [predicate.name], values: {} }]]
    case 'equal':
      return [[{ identifiers: [], values: { [predicate.key]: predicate.value } }]]
    case 'not-equal':
    case 'not':
      return [[empty]]
    case 'or':
      return predicatePaths(predicate.left).concat(predicatePaths(predicate.right))
    case 'descendant':
      return combinePaths(predicatePaths(predicate.parent), predicatePaths(predicate.child), false)
    case 'and':
      return combinePaths(predicatePaths(predicate.left), predicatePaths(predicate.right), true)
  }
}

function combinePaths(
  left: readonly ContextPath[],
  right: readonly ContextPath[],
  merge: boolean,
): readonly ContextPath[] {
  return left.flatMap((a) =>
    right.map((b) => {
      if (!merge) return a.concat(b)
      const first = a.at(-1) ?? empty
      const second = b.at(-1) ?? empty
      const combined = {
        identifiers: first.identifiers.concat(second.identifiers),
        values: { ...first.values, ...second.values },
      }
      return a.slice(0, -1).concat(b.slice(0, -1), [combined])
    }),
  )
}

export function contextPathLabel(path: readonly KeyContext[]): string {
  return path
    .map(({ identifiers, values }) =>
      Array.from(identifiers)
        .concat(Array.from(values, ([key, value]) => `${key}=${value}`))
        .join(' '),
    )
    .join(' > ')
}
