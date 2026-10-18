import '@workspace/ui/globals.css'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { createMarkdownSession } from '@workspace/markdown/utils/session'

import { createProductionMarkdownProbe } from './factories/markdown-production'
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
const probe = Promise.all([ready, confirmFixtureEnvironment()]).then(([options]) =>
  createProductionMarkdownProbe(options),
)
window.markdownProductionProbe = {
  ready: probe.then(() => ({
    engine: candidate ? 'tree-sitter' : 'remark',
    initializationMs: performance.now() - started,
  })),
  run: async (source, chunks) => (await probe).run(source, chunks),
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
    if (!resolvedProbe) throw createClientInvariantError('Production probe is not ready')
    return resolvedProbe.activity()
  },
  dispose: async () => (await probe).dispose(),
}

let resolvedProbe: Awaited<typeof probe> | null = null
void probe.then((value) => {
  resolvedProbe = value
})

function probeSync() {
  return resolvedProbe
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
