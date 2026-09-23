import { act } from 'react'
import { MockProviderAdapter } from 'server/testing'
import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import { runPaletteCommand } from '../../../test/actions'
import { AccountProviderAdapter } from '../../../test/factories/provider-auth'

test('native model filtering and advertised effort selection return focus to the composer', async () => {
  const server = await makeTestServer({
    providerAdapter: new MockProviderAdapter({
      models: [
        {
          name: 'Thinking model',
          shortName: 'Think',
          slug: 'thinking-model',
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              {
                id: 'reasoningEffort',
                label: 'Reasoning effort',
                type: 'select',
                options: [{ id: 'ultra', label: 'Ultra', description: 'Deep reasoning' }],
              },
            ],
          },
        },
      ],
    }),
  })
  const harness = await renderAgentStage(server)
  const { frame } = harness
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Choose model')
    await act(async () => {
      await frame.renderOnce()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-model-filter')
    await act(async () => {
      await frame.mockInput.typeText('Thinking')
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-model-effort')
    await act(async () => {
      frame.mockInput.pressArrow('down')
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Think · ultra')
    await runPaletteCommand(frame, 'Choose model')
    await act(async () => {
      await frame.mockInput.typeText('Codex')
      frame.mockInput.pressArrow('down')
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('managed by its CLI on the server')
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    await act(async () => {
      await frame.renderOnce()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-model-filter')
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
  } finally {
    await harness.cleanup()
    await server.cleanup()
  }
})

test('native provider account enters the real sign-in flow and Escape cancels the server attempt', async () => {
  const provider = new AccountProviderAdapter()
  const server = await makeTestServer({ providerAdapter: provider })
  const harness = await renderAgentStage(server)
  const { frame } = harness
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Choose model')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-model-filter')
    await act(async () => {
      await frame.mockInput.typeText('Codex')
      frame.mockInput.pressArrow('down')
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(() => frame.renderer.currentFocusedRenderable?.id)
      .toBe('agent-provider-methods')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('browser opened on the server')
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    await expect.poll(() => provider.cancellations.length).toBe(1)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-model-filter')
  } finally {
    await harness.cleanup()
    await server.cleanup()
  }
})

test.for([true, false])(
  'submitted model filter chooses its match with batched input %s',
  async (batched) => {
    const server = await makeTestServer({
      providerAdapter: new MockProviderAdapter({
        models: [
          {
            name: 'Alpha model',
            shortName: 'Alpha',
            slug: 'alpha-model',
            isCustom: false,
            capabilities: null,
          },
          {
            name: 'Beta model',
            shortName: 'Beta',
            slug: 'beta-model',
            isCustom: false,
            capabilities: null,
          },
        ],
      }),
    })
    const harness = await renderAgentStage(server)
    const { frame } = harness
    try {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await runPaletteCommand(frame, 'Choose model')
      await expect
        .poll(() => frame.renderer.currentFocusedRenderable?.id)
        .toBe('agent-model-filter')
      await act(async () => {
        await frame.mockInput.typeText('Beta')
        if (batched) frame.mockInput.pressEnter()
      })
      if (!batched)
        await act(async () => {
          frame.mockInput.pressEnter()
        })
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await frame.renderOnce()
      expect(frame.captureCharFrame()).toContain('Beta')
    } finally {
      await harness.cleanup()
      await server.cleanup()
    }
  },
)
