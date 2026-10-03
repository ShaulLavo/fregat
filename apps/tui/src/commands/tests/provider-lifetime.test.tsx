import { act } from 'react'

import { CommandProvider } from '@/commands/providers/command-provider'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test.for([{ closes: 'unmount' }, { closes: 'abort' }])(
  'closing the native command lifetime through $closes retires pending callbacks',
  async ({ closes }) => {
    const pending = Promise.withResolvers<boolean>()
    const lifetime = new AbortController()
    let started = false
    let completed = false
    const errors: unknown[] = []
    const frame = await renderTui(
      <CommandProvider
        signal={lifetime.signal}
        scope={{ screen: 'settings', environmentId: 'test', projectId: null }}
        handlers={{
          'workspace.reconnect': {
            run: () => {
              started = true
              return pending.promise
            },
          },
        }}
        overrides={[]}
        onExecuted={() => {
          completed = true
        }}
        onError={(error) => errors.push(error)}
      >
        <text>Command owner</text>
      </CommandProvider>,
      { width: 50, height: 12, useThread: false },
    )
    try {
      await act(async () => {
        frame.mockInput.pressKey('r', { ctrl: true })
      })
      expect(started).toBe(true)
      if (closes === 'unmount') await frame.render(null)
      else lifetime.abort()
      pending.resolve(true)
      await pending.promise
      expect(completed).toBe(false)
      expect(errors).toEqual([])
    } finally {
      pending.resolve(true)
      await frame.cleanup()
    }
  },
)
