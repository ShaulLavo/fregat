import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTranscriptUsageService } from '../provider/transcript-history'
import { modelPrice } from '../provider/utils/model-prices'

export const TRANSCRIPT_FIXTURE_NOW = Date.parse('2026-10-03T12:00:00Z')

export const nativeClaudeResponse = (id: string, output = 20) => ({
  type: 'assistant',
  timestamp: '2026-10-03T10:00:00Z',
  message: { id, model: 'test-model', usage: { input_tokens: 100, output_tokens: output } },
})

export async function transcriptHistoryFixture(cleanup: Array<() => Promise<void>>) {
  const root = await mkdtemp(join(tmpdir(), 'usage-transcripts-'))
  const transcripts = join(root, 'native', 'outside-projects')
  await mkdir(transcripts, { recursive: true })
  const options = {
    cacheDirectory: join(root, 'cache'),
    hostId: 'fixture-host',
    sources: [{ id: 'claude-native', driverKind: 'claude' as const, roots: [transcripts] }],
    limits: { maxBytes: 1024 * 1024, maxFiles: 100, maxLineBytes: 64 * 1024, readChunkBytes: 1024 },
    priceCatalog: {
      lookupLocal: (driver: string, model: string) =>
        modelPrice(
          {
            fetchedAt: '2026-10-01T00:00:00Z',
            prices: {
              'anthropic/test-model': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
            },
          },
          driver,
          model,
        ),
    },
    now: () => TRANSCRIPT_FIXTURE_NOW,
  }
  const service = new LocalTranscriptUsageService(options)
  await service.initialize()
  cleanup.push(async () => {
    service.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, transcripts, options, service }
}
