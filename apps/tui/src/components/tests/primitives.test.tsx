import { TextareaRenderable } from '@opentui/core'
import { act } from 'react'
import { vi } from 'vitest'

import { Dialog } from '@/components/dialog'
import { CommandProvider } from '@/commands/providers/command-provider'
import { Prompt } from '@/components/prompt'
import { TextPrompt } from '@/components/text-prompt'
import { OrbitLoader } from '@/components/orbit-loader'
import { RingLoader } from '@/components/ring-loader'
import { Spinner } from '@/components/spinner'
import { Shimmer } from '@/components/shimmer'
import { LoadingState } from '@/components/loading-state'
import { EmptyState } from '@/components/empty-state'
import { Toast } from '@/components/toast'
import { resolveTheme } from '@/theme/utils/theme'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test('dialog prompt submits the native current input and Escape dismisses once', async () => {
  const submitted: string[] = []
  let dismissed = 0
  const theme = resolveTheme('dark', 'dark', true)
  const frame = await renderTui(
    <CommandProvider
      scope={{ screen: 'settings', environmentId: 'test', projectId: null }}
      handlers={{}}
      overrides={[]}
      onError={(error) => expect.unreachable(String(error))}
    >
      <Dialog
        title='Edit setting'
        theme={theme}
        onClose={() => {
          dismissed += 1
        }}
      >
        <Prompt
          theme={theme}
          value=''
          onChange={() => {}}
          onSubmit={(value) => submitted.push(value)}
        />
      </Dialog>
    </CommandProvider>,
    { width: 44, height: 12, useThread: false },
  )
  try {
    await act(async () => {
      await frame.mockInput.typeText('new value')
      frame.mockInput.pressEnter()
      frame.mockInput.pressEscape()
      await expect.poll(() => dismissed).toBe(1)
    })
    await frame.renderOnce()
    expect(submitted).toEqual(['new value'])
    expect(dismissed).toBe(1)
    expect(frame.captureCharFrame()).toContain('Edit setting')
  } finally {
    await frame.cleanup()
  }
})

test.each(['{"emoji": "🌿", "count": 42}', '{\n\t"value": "界é",\n\t"count": 42\n}'])(
  'JSON prompt paints shared syntax colors through Unicode and multiline text: %s',
  async (value) => {
    const theme = resolveTheme('dark', 'dark', false)
    const changes: string[] = []
    const frame = await renderTui(
      <TextPrompt
        language='json'
        theme={theme}
        value={value}
        onChange={(value) => changes.push(value)}
        onSubmit={() => {}}
      />,
      { width: 52, height: 10, useThread: false },
    )
    try {
      const input = frame.renderer.currentFocusedRenderable
      if (!(input instanceof TextareaRenderable))
        return expect.unreachable('Expected the native textarea to have focus.')
      await expect.poll(() => input.syntaxStyle?.getStyle('number')?.fg).toBeDefined()
      await frame.renderOnce()
      const number = frame
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes('42'))
      expect(number).toBeDefined()
      expect(number?.fg.toInts()).toEqual(input.syntaxStyle?.getStyle('number')?.fg?.toInts())
      await act(async () => {
        frame.mockInput.pressEnter()
      })
      expect(changes.at(-1)).toContain('\n')
      await frame.renderOnce()
      expect(frame.captureCharFrame()).toContain('"count": 42')
    } finally {
      await frame.cleanup()
    }
  },
)

test('all five loader roles render and reduced motion continues at half speed', async () => {
  const frame = await renderTui(null, { width: 55, height: 20, useThread: false })
  const theme = resolveTheme('dark', 'dark', true)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    await frame.render(
      <box flexDirection='column'>
        <box flexDirection='row'>
          <text>Normal </text>
          <Spinner theme={theme} />
        </box>
        <box flexDirection='row'>
          <text>Reduced </text>
          <Spinner theme={theme} reducedMotion />
        </box>
        <box flexDirection='row'>
          <text>Orbit </text>
          <OrbitLoader theme={theme} />
        </box>
        <RingLoader theme={theme} label='Quiet wait' />
        <text>
          Still <Shimmer text='processing 🌿' theme={theme} />
        </text>
        <LoadingState theme={theme} label='Fetching files…' />
      </box>,
    )
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Normal |')
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Normal /')
    expect(frame.captureCharFrame()).toContain('Reduced |')
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Reduced /')
    expect(frame.captureCharFrame()).toContain('processing 🌿')
    expect(frame.captureCharFrame()).toContain('Fetching files…')
    await frame.render(null)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
    await frame.cleanup()
  }
})

test('empty verdicts and auto-dismissed notices remain readable without color', async () => {
  const theme = resolveTheme('dark', 'dark', true)
  let dismissed = 0
  const frame = await renderTui(
    <box flexDirection='column'>
      <EmptyState title='No matching files' description='Try a shorter query.' theme={theme} />
      <Toast
        message='Settings saved'
        tone='success'
        theme={theme}
        onDismiss={() => {
          dismissed += 1
        }}
        durationMs={30}
      />
    </box>,
    { width: 48, height: 8, useThread: false },
  )
  try {
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('No matching files')
    expect(frame.captureCharFrame()).toContain('SUCCESS · Settings saved')
    await expect.poll(() => dismissed).toBe(1)
  } finally {
    await frame.cleanup()
  }
})
