import { runPaletteCommand } from '../../../test/actions'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import { test, expect } from '../../../test/fixtures'

test('palette command settlement starts after dismissal commits and dispatches the command', async ({
  server,
}) => {
  const harness = await renderAgentStage(server)
  try {
    await runPaletteCommand(harness.frame, 'Filter sessions', async () => {
      expect(harness.frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail-filter')
    })
  } finally {
    await harness.cleanup()
  }
})
