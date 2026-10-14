import { createHash } from 'node:crypto'
import { createScriptError } from '../structured-errors'

export async function coldWorker(raw: string | undefined) {
  const input: unknown = raw ? JSON.parse(raw) : null
  if (
    !input ||
    typeof input !== 'object' ||
    !('source' in input) ||
    typeof input.source !== 'string'
  ) {
    throw createScriptError('Cold benchmark input requires a source', {
      internal: { inputType: typeof input },
    })
  }
  const source = input.source
  const cpu = process.cpuUsage()
  const started = performance.now()
  const { createMarkdownSession } = await import('../../packages/markdown/src/utils/session')
  const { createHastProcessor, blockToHast } =
    await import('../../packages/markdown/src/utils/hast')
  const { readyRemarkExtensions } = await import('../../packages/markdown/test/qualification')
  const extensions = await readyRemarkExtensions()
  const imported = performance.now()
  const session = createMarkdownSession()
  const processor = createHastProcessor(extensions)
  const initialized = performance.now()
  const blocks = session.update(source, { heal: false })
  const parsed = performance.now()
  const root = {
    type: 'root',
    children: blocks.flatMap((block) => blockToHast(block, processor).children),
  }
  const projected = performance.now()
  const used = process.cpuUsage(cpu)
  const digest = createHash('sha256').update(JSON.stringify(root)).digest('hex')
  return {
    dependencyImportMs: imported - started,
    initializationMs: initialized - imported,
    parseMs: parsed - initialized,
    projectionMs: projected - parsed,
    firstResultMs: projected - started,
    cpuMs: (used.user + used.system) / 1000,
    sourceBytes: Buffer.byteLength(source),
    digest,
  }
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(await coldWorker(process.argv[2]))}\n`)
