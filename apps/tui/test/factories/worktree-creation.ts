import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { orchestrationForApp } from 'server/testing'
import type { TestServer } from '../server'

export function interruptWorktreeCreation(server: TestServer) {
  const engine = orchestrationForApp(server.app)
  assert(engine)
  return engine.subscribeDomainEvents({
    name: 'tui-test-provisioning-disk-collision',
    handleEvents(events) {
      const event = events.find((item) => item.type === 'worktree.create-requested')
      if (event?.type !== 'worktree.create-requested') return
      mkdirSync(dirname(event.payload.canonicalPath), { recursive: true })
      writeFileSync(event.payload.canonicalPath, 'Creation interrupted')
    },
  })
}
