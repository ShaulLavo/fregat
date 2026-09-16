import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished } from 'vitest'
import { FileSystemService } from '../../src/fs/service'
import type { WatchServerMessage } from '../../src/fs/contracts'
import type { WatchBackend } from '../../src/fs/watch'

export async function watchedFiles(backend: WatchBackend = 'node', enabled = true) {
  const directory = await mkdtemp(path.join(scratchRoot(), 'platform-write-events-'))
  const root = path.join(directory, 'root')
  await mkdir(root)
  const service = new FileSystemService({
    workspaceRoot: root,
    watch: enabled,
    watchBackend: backend,
    metadataDatabasePath: path.join(directory, 'metadata.sqlite'),
    workspaceEditJournalRoot: path.join(directory, 'journal'),
  })
  const abort = new AbortController()
  const stream = service.events([''], abort.signal)[Symbol.asyncIterator]()
  const events: WatchServerMessage[] = []
  await stream.next()
  const collecting = (async () => {
    for await (const event of { [Symbol.asyncIterator]: () => stream }) events.push(event)
  })()
  onTestFinished(async () => {
    abort.abort()
    await collecting
    await stream.return?.(undefined)
    await service.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { root, service, events }
}

// The data SSD scratch on the owner's machine; CI runners only have the system temp.
function scratchRoot(): string {
  return existsSync('/work/tmp') ? '/work/tmp' : tmpdir()
}
