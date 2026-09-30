import type mermaid from 'mermaid'
import {
  diagramClassNames,
  isolateDiagramRecords,
  isolateDiagramDecoration,
} from '@/features/chat/utils/diagram-classes'

type DiagramParser = Awaited<ReturnType<typeof mermaid.mermaidAPI.getDiagramFromText>>['parser']

export async function withIsolatedDiagramClasses<T>(
  parser: DiagramParser,
  render: () => Promise<T>,
): Promise<T> {
  const original = parser.parse
  parser.parse = (text) => parseIsolated(parser, original, text)
  try {
    return await render()
  } finally {
    parser.parse = original
  }
}

async function parseIsolated(parser: DiagramParser, parse: DiagramParser['parse'], text: string) {
  const state = parser.parser
  if (!state) return parse.call(parser, text)
  const database = state.yy
  // Only parser calls see the proxy; renderer-internal classes keep their identity.
  state.yy = new Proxy(database, { get: classDatabaseMethod })
  try {
    return await parse.call(parser, text)
  } finally {
    state.yy = database
  }
}

function classDatabaseMethod(database: object, key: string | symbol): unknown {
  const method: unknown = Reflect.get(database, key, database)
  if (typeof method !== 'function') return method
  // Flow uses addClass for CSS definitions; class diagrams use it for node identities.
  if (key === 'defineClass' || (key === 'addClass' && 'setClass' in database))
    return (...args: unknown[]) => Reflect.apply(method, database, isolateClassArgument(args, 0))
  if (key === 'setClass' || key === 'setCssClass')
    return (...args: unknown[]) => Reflect.apply(method, database, isolateClassArgument(args, 1))
  if (key === 'setRootDoc' || key === 'setHierarchy')
    return (document: unknown) => Reflect.apply(method, database, [isolateDiagramRecords(document)])
  if (key === 'decorateNode')
    return (decoration: unknown) =>
      Reflect.apply(method, database, [isolateDiagramDecoration(decoration)])
  return method
}

function isolateClassArgument(args: readonly unknown[], index: number): unknown[] {
  return args.map((arg, at) => (at === index ? isolateClassNames(arg) : arg))
}

function isolateClassNames(value: unknown): unknown {
  if (typeof value === 'string') return diagramClassNames(value)
  if (Array.isArray(value)) return value.map(isolateClassNames)
  return value
}
