import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { DomTerminalRenderer, Terminal } from '../../index.js'
import type { GhosttyWebGpuTerminalOptions } from '../../index.js'
import type { Extension, ExtensionInput, ExtensionScope, TerminalInputEvent } from '../../index.js'

const terminals: Terminal[] = []
const hosts: HTMLElement[] = []
const decoder = new TextDecoder()

afterEach(() => {
  for (const terminal of terminals.splice(0)) terminal.dispose()
  for (const host of hosts.splice(0)) host.remove()
})

async function openTerminal(options: GhosttyWebGpuTerminalOptions = {}): Promise<Terminal> {
  const host = document.createElement('div')
  host.style.width = '320px'
  host.style.height = '120px'
  document.body.append(host)
  hosts.push(host)
  const terminal = await Terminal.create({
    rendererFactory: DomTerminalRenderer.create,
    ...options,
  })
  terminals.push(terminal)
  await terminal.open(host)
  return terminal
}

function press(terminal: Terminal, key = 'a', code = 'KeyA'): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })
  terminal.textarea!.dispatchEvent(event)
  return event
}

function compose(
  terminal: Terminal,
  text: string,
  order: 'input-first' | 'end-first' | 'end-only',
): void {
  const textarea = terminal.textarea!
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
  textarea.value = text
  textarea.dispatchEvent(
    new InputEvent('input', {
      data: text,
      inputType: 'insertCompositionText',
      isComposing: true,
    }),
  )
  if (order === 'input-first') {
    textarea.dispatchEvent(
      new InputEvent('input', {
        data: text,
        inputType: 'insertCompositionText',
        isComposing: false,
      }),
    )
  }
  textarea.dispatchEvent(new CompositionEvent('compositionend', { data: text }))
  if (order === 'end-first') {
    textarea.dispatchEvent(
      new InputEvent('input', {
        data: text,
        inputType: 'insertCompositionText',
        isComposing: false,
      }),
    )
  }
}

describe('public extension activation', () => {
  it.each(['input-first', 'end-first'] as const)(
    'publishes an unclaimed composition commit exactly once for %s order',
    async (order) => {
      const terminal = await openTerminal()
      const output: string[] = []
      terminal.onData((data) => output.push(decoder.decode(data)))
      compose(terminal, '中', order)
      expect(output).toEqual(['中'])
    },
  )
  it('installs readonly nested presets before opening the real terminal', async () => {
    const order: number[] = []
    const extension = (value: number): Extension => ({
      name: String(value),
      setup: (scope) => {
        expect(scope.terminal.lifecycle).toBe('created')
        order.push(value)
        return {}
      },
    })
    const extensions: readonly ExtensionInput[] = [extension(1), [extension(2), [extension(3)]]]
    await openTerminal({ extensions })
    expect(order).toEqual([1, 2, 3])
  })

  it('observes a known-good native key and lets an extension claim before any PTY output', async () => {
    const control = await openTerminal()
    const controlOutput: string[] = []
    control.onData((data) => controlOutput.push(decoder.decode(data)))
    press(control)
    expect(controlOutput).toEqual(['a'])
    const claimed: KeyboardEvent[] = []
    const terminal = await openTerminal({
      extensions: [
        {
          name: 'claim-key',
          setup: () => ({
            input: (input) => {
              if (input.type === 'key' && 'event' in input) claimed.push(input.event)
              return 'claim'
            },
          }),
        },
      ],
    })
    const output: string[] = []
    terminal.onData((data) => output.push(decoder.decode(data)))
    const event = press(terminal)
    expect(claimed).toEqual([event])
    expect(event.defaultPrevented).toBe(true)
    const modified = new KeyboardEvent('keydown', {
      key: 'Z',
      code: 'KeyZ',
      ctrlKey: true,
      altKey: true,
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    })
    terminal.textarea!.dispatchEvent(modified)
    expect(claimed[1]).toBe(modified)
    expect(modified.defaultPrevented).toBe(true)
    expect(output).toEqual([])
  })

  it('returns a typed synchronous API with per-terminal identity and reverse cleanup', async () => {
    const order: string[] = []
    const signals: AbortSignal[] = []
    const shared: Extension<{ value: number }> = {
      name: 'shared',
      setup: (scope) => {
        signals.push(scope.signal)
        scope.own(() => order.push('first'))
        scope.own(() => order.push('last'))
        return { api: { value: signals.length } }
      },
    }
    const first = await openTerminal()
    const second = await openTerminal()
    const handle = first.use(shared)
    expectTypeOf(handle.api).toEqualTypeOf<{ value: number }>()
    expect(handle.api.value).toBe(1)
    expect(second.use(shared).api.value).toBe(2)
    expect(() => first.use(shared)).toThrow('already attached')
    expect(signals[0]).not.toBe(signals[1])
    handle.dispose()
    handle.dispose()
    expect(order).toEqual(['last', 'first'])
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    first.use(shared)
    first.dispose()
    expect(order).toEqual(['last', 'first', 'last', 'first'])
    second.dispose()
    expect(order).toEqual(['last', 'first', 'last', 'first', 'last', 'first'])
  })

  it('disposes public attachments and their owned resources in reverse order once', async () => {
    const order: string[] = []
    const terminal = await openTerminal()
    const extension = (name: string): Extension => ({
      name,
      setup: (scope) => {
        scope.own(() => order.push(`${name}.first`))
        scope.own(() => order.push(`${name}.last`))
        return {}
      },
    })
    const first = terminal.use(extension('first'))
    const last = terminal.use(extension('last'))
    terminal.dispose()
    first.dispose()
    last.dispose()
    terminal.dispose()
    expect(order).toEqual(['last.last', 'last.first', 'first.last', 'first.first'])
  })

  it('rolls back a failed readonly preset and its acquired native owner', async () => {
    const order: string[] = []
    const scopes: ExtensionScope[] = []
    const failure = Symbol('setup failure')
    const good: Extension = {
      name: 'good',
      setup: (scope) => {
        scopes.push(scope)
        scope.own(() => order.push('good'))
        return {}
      },
    }
    const bad: Extension = {
      name: 'bad',
      setup: (scope) => {
        scopes.push(scope)
        scope.own(() => order.push('bad'))
        throw failure
      },
    }
    await expect(Terminal.create({ extensions: [good, [bad]] })).rejects.toBe(failure)
    expect(order).toEqual(['bad', 'good'])
    expect(scopes.every((scope) => scope.signal.aborted)).toBe(true)
    expect(scopes[0]?.terminal.lifecycle).toBe('disposed')
    expect(() => scopes[0]?.terminal.appearance).toThrow('disposed')
  })

  it('releases real DOM and input controllers when opening fails after input installation', async () => {
    const failure = Symbol('observer factory failure')
    let signal: AbortSignal | undefined
    let textarea: HTMLTextAreaElement | undefined
    const terminal = await Terminal.create({
      extensions: [
        {
          name: 'lifetime',
          setup: (scope) => {
            signal = scope.signal
            return {}
          },
        },
      ],
      rendererFactory: async (options) => {
        textarea = (options.canvas as HTMLCanvasElement).parentElement!.querySelector('textarea')!
        return DomTerminalRenderer.create(options)
      },
      fitEnvironment: {
        createResizeObserver: () => {
          throw failure
        },
      },
    })
    terminals.push(terminal)
    const host = document.createElement('div')
    host.style.width = '320px'
    host.style.height = '120px'
    document.body.append(host)
    hosts.push(host)
    await expect(terminal.open(host)).rejects.toBe(failure)
    expect(terminal.lifecycle).toBe('disposed')
    expect(signal?.aborted).toBe(true)
    expect(host.childElementCount).toBe(0)
    expect(textarea?.isConnected).toBe(false)
    expect(() =>
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'a',
          code: 'KeyA',
          cancelable: true,
        }),
      ),
    ).not.toThrow()
  })

  it('rolls back disposal during synchronous setup', async () => {
    const order: string[] = []
    let scopeValue: ExtensionScope | undefined
    await expect(
      Terminal.create({
        extensions: [
          {
            name: 'dispose-in-setup',
            setup: (scope) => {
              scopeValue = scope
              scope.own(() => order.push('cleanup'))
              scope.terminal.dispose()
              return {}
            },
          },
        ],
      }),
    ).rejects.toThrow('disposed')
    expect(order).toEqual(['cleanup'])
    expect(scopeValue?.signal.aborted).toBe(true)
    expect(scopeValue?.terminal.lifecycle).toBe('disposed')
  })

  it('rejects unavailable OSC ownership and rolls back setup resources', async () => {
    const terminal = await openTerminal()
    let cleaned = 0
    expect(() =>
      terminal.use({
        name: 'osc',
        setup: (scope) => {
          scope.own(() => (cleaned += 1))
          return { osc: { 777: () => {} } }
        },
      }),
    ).toThrow('Custom OSC observation is unavailable')
    expect(cleaned).toBe(1)
    const output: string[] = []
    terminal.onData((data) => output.push(decoder.decode(data)))
    press(terminal)
    expect(output).toEqual(['a'])
  })

  it('claims original DOM paste, committed composition, text and programmatic input', async () => {
    const inputs: TerminalInputEvent[] = []
    const terminal = await openTerminal({
      extensions: [
        {
          name: 'claim',
          setup: () => ({
            input: (input) => {
              inputs.push(input)
              return 'claim'
            },
          }),
        },
      ],
    })
    const output: string[] = []
    terminal.onData((data) => output.push(decoder.decode(data)))
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'paste\ntext')
    const paste = new ClipboardEvent('paste', { clipboardData, cancelable: true })
    terminal.textarea!.dispatchEvent(paste)
    compose(terminal, '中', 'end-first')
    terminal.textarea!.dispatchEvent(
      new InputEvent('input', {
        data: 'text',
        inputType: 'insertText',
      }),
    )
    expect(terminal.paste('programmatic paste')).toHaveLength(0)
    expect(terminal.sendInput('programmatic text')).toHaveLength(0)
    const bytes = new Uint8Array([0xc3, 0xa9])
    expect(terminal.sendInput(bytes)).toHaveLength(0)
    const input = { action: 'press', code: 'KeyA', text: 'a', composing: false } as const
    expect(terminal.key(input)).toHaveLength(0)
    expect(inputs).toEqual([
      { type: 'paste', data: 'paste\ntext' },
      { type: 'composition', text: '中' },
      { type: 'text', data: 'text' },
      { type: 'paste', data: 'programmatic paste' },
      { type: 'text', data: 'programmatic text' },
      { type: 'text', data: bytes },
      { type: 'key', input },
    ])
    expect(paste.defaultPrevented).toBe(true)
    expect(output).toEqual([])
  })

  it.each(['input-first', 'end-first'] as const)(
    'claims one composition commit for %s order',
    async (order) => {
      const inputs: TerminalInputEvent[] = []
      const terminal = await openTerminal({
        extensions: [
          {
            name: 'composition',
            setup: () => ({
              input: (input) => {
                inputs.push(input)
                return 'claim'
              },
            }),
          },
        ],
      })
      const output: string[] = []
      terminal.onData((data) => output.push(decoder.decode(data)))
      compose(terminal, '中', order)
      expect(inputs).toEqual([{ type: 'composition', text: '中' }])
      expect(output).toEqual([])
    },
  )

  it.each(['cancel', 'blur', 'dispose'] as const)(
    'drops pending composition after %s',
    async (action) => {
      const terminal = await openTerminal()
      terminal.focus()
      const textarea = terminal.textarea!
      const output: string[] = []
      terminal.onData((data) => output.push(decoder.decode(data)))
      textarea.dispatchEvent(new CompositionEvent('compositionstart'))
      textarea.value = '中'
      textarea.dispatchEvent(
        new InputEvent('input', {
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true,
        }),
      )
      if (action === 'blur') terminal.blur()
      if (action === 'dispose') terminal.dispose()
      textarea.dispatchEvent(
        new CompositionEvent('compositionend', {
          data: action === 'cancel' ? '' : '中',
        }),
      )
      textarea.dispatchEvent(
        new InputEvent('input', {
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: false,
        }),
      )
      expect(output).toEqual([])
      if (action !== 'dispose') {
        press(terminal)
        expect(output).toEqual(['a'])
      }
    },
  )

  it.each(['x', '中'])(
    'preserves a separate keyless text action %s after an end-only composition',
    async (later) => {
      const inputs: TerminalInputEvent[] = []
      const terminal = await openTerminal({
        extensions: [
          {
            name: 'observe',
            setup: () => ({
              input: (input) => {
                inputs.push(input)
                return 'pass'
              },
            }),
          },
        ],
      })
      const output: string[] = []
      terminal.onData((data) => output.push(decoder.decode(data)))
      const textarea = terminal.textarea!
      textarea.dispatchEvent(new CompositionEvent('compositionstart'))
      textarea.value = '中'
      textarea.dispatchEvent(
        new InputEvent('input', {
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true,
        }),
      )
      textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '中' }))
      expect(output).toEqual(['中'])
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      textarea.value = later
      textarea.dispatchEvent(
        new InputEvent('input', {
          data: later,
          inputType: 'insertText',
          isComposing: false,
        }),
      )
      expect(output).toEqual(['中', later])
      expect(inputs).toEqual([
        { type: 'composition', text: '中' },
        { type: 'text', data: later },
      ])
    },
  )

  it('lets an extension claim a new identical keyless action after an end-only composition', async () => {
    const inputs: TerminalInputEvent[] = []
    const terminal = await openTerminal({
      extensions: [
        {
          name: 'text gate',
          setup: () => ({
            input: (input) => {
              inputs.push(input)
              return input.type === 'text' ? 'claim' : 'pass'
            },
          }),
        },
      ],
    })
    const output: string[] = []
    terminal.onData((data) => output.push(decoder.decode(data)))
    compose(terminal, '中', 'end-only')
    const textarea = terminal.textarea!
    textarea.value = '中'
    textarea.dispatchEvent(new InputEvent('input', { data: '中', inputType: 'insertText' }))
    expect(inputs).toEqual([
      { type: 'composition', text: '中' },
      { type: 'text', data: '中' },
    ])
    expect(output).toEqual(['中'])
  })

  it.each(['x', '中'])(
    'preserves a separate keyless text action %s after cancelling composition',
    async (later) => {
      const terminal = await openTerminal()
      const output: string[] = []
      terminal.onData((data) => output.push(decoder.decode(data)))
      const textarea = terminal.textarea!
      textarea.dispatchEvent(new CompositionEvent('compositionstart'))
      textarea.value = '中'
      textarea.dispatchEvent(
        new InputEvent('input', {
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true,
        }),
      )
      textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '' }))
      textarea.dispatchEvent(
        new InputEvent('input', {
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: false,
        }),
      )
      expect(output).toEqual([])
      textarea.value = later
      textarea.dispatchEvent(new InputEvent('input', { data: later, inputType: 'insertText' }))
      expect(output).toEqual([later])
    },
  )

  it('consumes the genuine composition final tail once and preserves a later identical text action', async () => {
    const terminal = await openTerminal()
    const output: string[] = []
    terminal.onData((data) => output.push(decoder.decode(data)))
    compose(terminal, '中', 'end-only')
    const textarea = terminal.textarea!
    const tail = new InputEvent('input', { data: '中', inputType: 'insertCompositionText' })
    expect(tail.inputType).toBe('insertCompositionText')
    textarea.dispatchEvent(tail)
    expect(output).toEqual(['中'])
    textarea.dispatchEvent(new InputEvent('beforeinput', { data: '中', inputType: 'insertText' }))
    textarea.value = '中'
    textarea.dispatchEvent(new InputEvent('input', { data: '中', inputType: 'insertText' }))
    expect(output).toEqual(['中', '中'])
  })

  it('preserves a later ordinary key with the same text as the previous composition', async () => {
    const terminal = await openTerminal()
    const output: string[] = []
    terminal.onData((data) => output.push(decoder.decode(data)))
    compose(terminal, '中', 'end-first')
    press(terminal, '中')
    expect(output).toEqual(['中', '中'])
  })

  it('passes through native bracketed paste and native query replies exactly once', async () => {
    let calls = 0
    const terminal = await openTerminal({
      extensions: [
        {
          name: 'pass',
          setup: () => ({
            input: () => {
              calls += 1
              return 'pass'
            },
          }),
        },
      ],
    })
    const output: string[] = []
    terminal.onData((data) => output.push(decoder.decode(data)))
    terminal.write('\x1b[?2004h')
    terminal.paste('a\nb')
    expect(output).toEqual(['\x1b[200~a\nb\x1b[201~'])
    expect(calls).toBe(1)
    terminal.use({ name: 'always claim', setup: () => ({ input: () => 'claim' }) })
    terminal.write('abc\x1b[6n')
    expect(output.at(-1)).toBe('\x1b[1;4R')
    expect(calls).toBe(1)
  })

  it('skips detached handlers, preserves later nodes and excludes new handlers until next input', async () => {
    const terminal = await openTerminal()
    const calls: string[] = []
    let attached = false
    let second: { dispose(): void }
    const late: Extension = {
      name: 'late',
      setup: () => ({
        input: () => {
          calls.push('late')
          return 'pass'
        },
      }),
    }
    terminal.use({
      name: 'first',
      setup: () => ({
        input: () => {
          calls.push('first')
          second.dispose()
          if (!attached) {
            attached = true
            terminal.use(late)
          }
          return 'pass'
        },
      }),
    })
    second = terminal.use({
      name: 'second',
      setup: () => ({
        input: () => {
          calls.push('second')
          return 'pass'
        },
      }),
    })
    terminal.use({
      name: 'third',
      setup: () => ({
        input: () => {
          calls.push('third')
          return 'pass'
        },
      }),
    })
    terminal.sendInput('a')
    expect(calls).toEqual(['first', 'third'])
    terminal.sendInput('b')
    expect(calls).toEqual(['first', 'third', 'first', 'third', 'late'])
  })

  it('stops at the first claim and suppresses native release after detaching a claimed press', async () => {
    const terminal = await openTerminal()
    const calls: string[] = []
    terminal.write('\x1b[>3u')
    const first = terminal.use({
      name: 'first',
      setup: () => ({
        input: () => {
          calls.push('first')
          return 'claim'
        },
      }),
    })
    const second = terminal.use({
      name: 'second',
      setup: () => ({
        input: () => {
          calls.push('second')
          return 'claim'
        },
      }),
    })
    const output: string[] = []
    terminal.onData((data) => output.push(decoder.decode(data)))
    press(terminal)
    first.dispose()
    second.dispose()
    terminal.textarea!.dispatchEvent(
      new KeyboardEvent('keyup', {
        key: 'a',
        code: 'KeyA',
        cancelable: true,
      }),
    )
    expect(calls).toEqual(['first'])
    expect(output).toEqual([])
  })

  it('does not encode a passed original key after a handler disposes the terminal', async () => {
    const terminal = await openTerminal()
    terminal.use({
      name: 'dispose-input',
      setup: () => ({
        input: () => {
          terminal.dispose()
          return 'pass'
        },
      }),
    })
    const output: string[] = []
    terminal.onData((data) => output.push(decoder.decode(data)))
    const event = press(terminal)
    expect(terminal.lifecycle).toBe('disposed')
    expect(event.defaultPrevented).toBe(true)
    expect(output).toEqual([])
  })

  it('broadcasts interested host events and contains a failing error handler', async () => {
    const clipboardFailure = Symbol('clipboard policy failure')
    const terminal = await openTerminal({
      clipboardWrite: () => {
        throw clipboardFailure
      },
    })
    const titles: string[] = []
    const publicErrors: unknown[] = []
    terminal.on('error', ({ cause }) => publicErrors.push(cause))
    terminal.use({
      name: 'events',
      setup: () => ({
        events: {
          title: (title) => titles.push(title),
          error: () => {
            throw 'extension error handler failure'
          },
        },
      }),
    })
    terminal.write('\x1b]0;one\x07')
    terminal.write('\x1b]0;two\x07')
    terminal.write('\x1b]52;c;eA==\x07')
    expect(titles).toEqual(['one', 'two'])
    expect(publicErrors).toHaveLength(2)
    expect(publicErrors[0]).toBe(clipboardFailure)
    expect(publicErrors.at(-1)).toBe('extension error handler failure')
  })

  it.each([0, 100, 1000])(
    'keeps %i inert attachments out of hot-path contribution reads',
    async (count) => {
      let reads = 0
      const extensions: Extension[] = Array.from({ length: count }, (_, index) => ({
        name: String(index),
        setup: () => ({
          get input() {
            reads += 1
            return undefined
          },
          get events() {
            reads += 1
            return undefined
          },
        }),
      }))
      const terminal = await openTerminal({ extensions })
      reads = 0
      let inputs = 0
      let titles = 0
      let frames = 0
      terminal.use({
        name: 'interested control',
        setup: () => ({
          input: () => {
            inputs += 1
            return 'pass'
          },
          events: { title: () => (titles += 1), frame: () => (frames += 1) },
        }),
      })
      terminal.sendInput('a')
      press(terminal)
      terminal.write('\x1b]0;counter\x07x')
      await vi.waitFor(() => expect(frames).toBeGreaterThan(0))
      expect(inputs).toBe(2)
      expect(titles).toBe(1)
      expect(reads).toBe(0)
    },
  )
})
