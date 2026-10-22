import '@workspace/ui/globals.css'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { createMarkdownSession } from '@workspace/markdown/utils/session'

import {
  createProductionMarkdownProbe,
  productionProbeLifecycle,
} from './factories/markdown-production'
import { createClientInvariantError } from '@/lib/structured-errors'
import { activeServerOrigin, getClient } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { TEST_ENVIRONMENT_ID } from './factories/chat'

const started = performance.now()
const candidate = new URL(location.href).searchParams.get('engine') === 'tree-sitter'
const ready = candidate
  ? candidateFactory()
  : Promise.resolve({
      factory: createMarkdownSession,
      parserMemoryBytes: null,
    })
const lifecycle = productionProbeLifecycle(
  Promise.all([ready, confirmFixtureEnvironment()]).then(([options]) =>
    createProductionMarkdownProbe(options),
  ),
)
const probe = lifecycle.ready
window.markdownProductionProbe = {
  ready: probe.then(async (value) => {
    await value.ready
    return {
      engine: candidate ? 'tree-sitter' : 'remark',
      initializationMs: performance.now() - started,
    }
  }),
  run: async (source, chunks) => (await probe).run(source, chunks),
  streamOracle: async (source, chunks, sink) => (await probe).streamOracle(source, chunks, sink),
  time: async (source, chunks, options) => (await probe).time(source, chunks, options),
  show: async (source, live) => (await probe).show(source, live),
  resources: async (source, windows, simultaneous) =>
    (await probe).resources(source, windows, simultaneous),
  mountTimeline: async (count, source) => (await probe).mountTimeline(count, source),
  updateTimeline: async (source, live) => (await probe).updateTimeline(source, live),
  observeTimeline: () => {
    const value = probeSync()
    if (!value) throw createClientInvariantError('Production timeline probe is not ready')
    return value.observeTimeline()
  },
  activity: () => {
    const current = lifecycle.current()
    if (!current) throw createClientInvariantError('Production probe is not ready')
    return current.activity()
  },
  dispose: async () => lifecycle.dispose(),
}

function probeSync() {
  return lifecycle.current()
}

async function candidateFactory() {
  const [module, parser, grammar, chatGrammar, resolver, runtime] = await Promise.all([
    import('@workspace/markdown/utils/tree-sitter-session'),
    import('web-tree-sitter/web-tree-sitter.wasm?url'),
    import('tree-sitter-md/tree-sitter-markdown.wasm?url'),
    import('tree-sitter-md/tree-sitter-markdown-chat.wasm?url'),
    import('tree-sitter-md/tree-sitter-md.wasm?url'),
    import('tree-sitter-md'),
  ])
  await module.initializeTreeSitterMarkdown({
    parser: { locateFile: () => parser.default },
    grammar: grammar.default,
    chatGrammar: chatGrammar.default,
    resolver: resolver.default,
  })
  return {
    factory: module.createTreeSitterMarkdownSession,
    parserMemoryBytes: runtime.memoryBytes,
  }
}

async function confirmFixtureEnvironment() {
  const descriptor = v.parse(healthDescriptorSchema, (await getClient().health.get()).data)
  if (descriptor.environmentId !== TEST_ENVIRONMENT_ID)
    throw createClientInvariantError('Production measurements require the fixture environment')
  useEnvironmentsStore.getState().recordDescriptor(activeServerOrigin(), descriptor)
}
