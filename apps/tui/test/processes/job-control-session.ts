import { runInteractive } from '@/host/interactive'
import { makeTestServer } from '../server'
import { createTestSettingsSession } from '../factories/session'

const server = await makeTestServer()
const session = createTestSettingsSession(server)
try {
  await runInteractive(session, true)
  const state = session.getSnapshot()
  if (state.kind === 'ready') {
    process.stdout.write(`\nTUI_CLOSED ${JSON.stringify(state.owner.readSettingsMirror())}\n`)
  }
} finally {
  session.dispose()
  await session.flush()
  await server.cleanup()
}
process.exit()
