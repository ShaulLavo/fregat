import '@workspace/ui/globals.css'
import { createMarkdownSession } from '@workspace/markdown/utils/session'

import { createProductionMarkdownProbe } from './factories/markdown-production'

const started = performance.now()
const candidate = new URL(location.href).searchParams.get('engine') === 'tree-sitter'
const ready = candidate
  ? candidateFactory()
  : Promise.resolve({ factory: createMarkdownSession, parserMemoryBytes: null })
const probe = ready.then((options) => createProductionMarkdownProbe(options))
window.markdownProductionProbe = {
  ready: probe.then(() => ({
    engine: candidate ? 'tree-sitter' : 'remark',
    initializationMs: performance.now() - started,
  })),
  run: async (source, chunks) => (await probe).run(source, chunks),
  time: async (source, chunks, options) => (await probe).time(source, chunks, options),
  show: async (source, live) => (await probe).show(source, live),
  resources: async (source, windows) => (await probe).resources(source, windows),
  mountTimeline: async (count, source) => (await probe).mountTimeline(count, source),
  updateTimeline: async (source, live) => (await probe).updateTimeline(source, live),
  dispose: async () => (await probe).dispose(),
}

async function candidateFactory() {
  const [module, parser, grammar, resolver, runtime] = await Promise.all([
    import('@workspace/markdown/utils/tree-sitter-session'),
    import('web-tree-sitter/web-tree-sitter.wasm?url'),
    import('tree-sitter-md/tree-sitter-markdown.wasm?url'),
    import('tree-sitter-md/tree-sitter-md.wasm?url'),
    import('tree-sitter-md'),
  ])
  await module.initializeTreeSitterMarkdown({
    parser: { locateFile: () => parser.default },
    grammar: grammar.default,
    resolver: resolver.default,
  })
  return { factory: module.createTreeSitterMarkdownSession, parserMemoryBytes: runtime.memoryBytes }
}
