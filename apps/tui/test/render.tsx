import { createTestRenderer, type TestRendererOptions } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import type { CliRenderer } from '@opentui/core'
import { act, type ReactNode } from 'react'
import { createTuiError } from '@/host/utils/structured-errors'

export async function renderTui(
  node: ReactNode,
  options: TestRendererOptions,
  configureRenderer?: (renderer: CliRenderer) => void,
) {
  const previous = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const frame = await createTestRenderer(options)
  configureRenderer?.(frame.renderer)
  const root = createRoot(frame.renderer)
  await act(async () => {
    root.render(node)
  })
  return {
    ...frame,
    async renderOnce() {
      await act(async () => {
        await frame.renderOnce()
      })
    },
    mockInput: {
      ...frame.mockInput,
      pressKey(...args: Parameters<typeof frame.mockInput.pressKey>) {
        if (/^(up|down|left|right)$/iu.test(args[0])) {
          throw createTuiError(
            'This input would type an arrow name instead of sending an arrow.',
            'Use mockInput.pressArrow(direction).',
          )
        }
        frame.mockInput.pressKey(...args)
      },
    },
    async render(next: ReactNode) {
      // OpenTUI creates a fresh reconciler container on each root.render call.
      await act(async () => {
        root.unmount()
      })
      await act(async () => {
        root.render(next)
      })
    },
    async cleanup() {
      try {
        await destroyFrame(root, frame.renderer)
      } finally {
        Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous)
      }
    },
  }
}

async function destroyFrame(root: ReturnType<typeof createRoot>, renderer: CliRenderer) {
  try {
    await act(async () => {
      root.unmount()
    })
  } finally {
    renderer.destroy()
  }
}
