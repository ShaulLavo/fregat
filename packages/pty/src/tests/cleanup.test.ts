import { expect, terminalDescriptors, test, withTerminalCleanup } from '../../test/fixtures'

for (const fails of [false, true]) {
  test(`settles deferred native descriptor cleanup after a ${fails ? 'failed' : 'successful'} scope`, async () => {
    const before = terminalDescriptors()
    let terminal: Bun.Terminal | undefined
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    const failure = new TypeError('Fixture scope failed')

    try {
      const completion = withTerminalCleanup(async () => {
        terminal = new Bun.Terminal({ cols: 80, rows: 24 })
        expect(terminalDescriptors()).not.toEqual(before)
        // Keep native descriptors alive across the scope's return, as deferred close does.
        closeTimer = setTimeout(() => terminal?.close(), 50)
        if (fails) throw failure
      })
      if (fails) await expect(completion).rejects.toBe(failure)
      if (!fails) await completion
      expect(terminalDescriptors()).toEqual(before)
    } finally {
      clearTimeout(closeTimer)
      terminal?.close()
      await expect.poll(terminalDescriptors).toEqual(before)
    }
  })
}

test('rejects a scope that leaves native PTY descriptors open', async () => {
  const before = terminalDescriptors()
  let terminal: Bun.Terminal | undefined

  try {
    const completion = withTerminalCleanup(async () => {
      terminal = new Bun.Terminal({ cols: 80, rows: 24 })
      expect(terminalDescriptors()).not.toEqual(before)
    })
    await expect(completion).rejects.toThrow()
    expect(terminalDescriptors()).not.toEqual(before)
  } finally {
    terminal?.close()
    await expect.poll(terminalDescriptors).toEqual(before)
  }
})
