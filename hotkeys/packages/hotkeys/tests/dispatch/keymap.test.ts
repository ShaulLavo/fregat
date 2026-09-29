// Translated from Zed's crates/gpui/src/keymap.rs tests (zed-industries/zed@933d8d9).
// Zed's NoAction is `command: null`, Unbind is `unbind`, and its meta indexes map to sources:
// USER → 'user', VIM → 'pack', BASE → 'base', DEFAULT → 'default'.
import { describe, expect, it } from 'vitest'
import { bindingsForInput, compileKeymap, createKeyInput, parseKeyContext } from '../../src'
import type { KeymapEntry } from '../../src'

function stroke(spec: string) {
  const parts = spec.split('-')
  const key = parts.pop()!
  return createKeyInput({
    key: key === 'space' ? ' ' : key,
    code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : '',
    modifiers: { ctrl: parts.includes('ctrl'), meta: parts.includes('cmd') },
  })
}
function lookup(entries: readonly KeymapEntry[], keys: string, stack: readonly string[]) {
  const result = bindingsForInput(
    compileKeymap(entries, 'linux'),
    keys.split(' ').map(stroke),
    stack.map(parseKeyContext),
  )
  return { commands: result.bindings.map((binding) => binding.command), pending: result.pending }
}

describe('Zed keymap resolution', () => {
  it('test_depth_precedence: the deeper context ranks first', () => {
    const entries: KeymapEntry[] = [
      { keys: 'Control+A', command: 'beta', context: 'pane' },
      { keys: 'Control+A', command: 'gamma', context: 'editor' },
    ]
    expect(lookup(entries, 'ctrl-a', ['pane', 'editor'])).toEqual({
      commands: ['gamma', 'beta'],
      pending: false,
    })
  })

  it('test_keymap_disabled: null disables in its context and globally', () => {
    const entries: KeymapEntry[] = [
      { keys: 'Control+A', command: 'alpha', context: 'editor' },
      { keys: 'Control+B', command: 'alpha', context: 'editor' },
      { keys: 'Control+A', command: null, context: 'editor && mode==full' },
      { keys: 'Control+B', command: null },
    ]
    expect(lookup(entries, 'ctrl-a', ['barf']).commands).toEqual([])
    expect(lookup(entries, 'ctrl-a', ['editor']).commands).toEqual(['alpha'])
    expect(lookup(entries, 'ctrl-a', ['editor mode=full']).commands).toEqual([])
    expect(lookup(entries, 'ctrl-b', ['barf']).commands).toEqual([])
  })

  it('test_multiple_keystroke_binding_disabled: null on a chord removes it from pending', () => {
    const disabled: KeymapEntry[] = [
      { keys: 'Space W W', command: 'alpha', context: 'workspace' },
      { keys: 'Space W W', command: null, context: 'editor' },
    ]
    const workspace = ['workspace']
    const editor = ['workspace', 'editor']
    expect(lookup(disabled, 'space', workspace)).toEqual({ commands: [], pending: true })
    expect(lookup(disabled, 'space', editor)).toEqual({ commands: [], pending: false })
    expect(lookup(disabled, 'space w', workspace)).toEqual({ commands: [], pending: true })
    expect(lookup(disabled, 'space w', editor)).toEqual({ commands: [], pending: false })
    expect(lookup(disabled, 'space w w', workspace)).toEqual({
      commands: ['alpha'],
      pending: false,
    })
    expect(lookup(disabled, 'space w w', editor)).toEqual({ commands: [], pending: false })

    const after: KeymapEntry[] = [
      ...disabled,
      { keys: 'Space W X', command: 'alpha', context: 'editor' },
    ]
    expect(lookup(after, 'space', editor).pending).toBe(true)
    const before: KeymapEntry[] = [
      disabled[0]!,
      { keys: 'Space W X', command: 'alpha', context: 'editor' },
      disabled[1]!,
    ]
    expect(lookup(before, 'space', editor).pending).toBe(true)
    const higher: KeymapEntry[] = [
      disabled[0]!,
      { keys: 'Space W X', command: 'alpha', context: 'workspace' },
      disabled[1]!,
    ]
    expect(lookup(higher, 'space', editor).pending).toBe(true)
  })

  it('test_override_multikey: a null prefix leaves the chord pending; a bound prefix after it wins', () => {
    expect(
      lookup(
        [
          { keys: 'Control+W ArrowLeft', command: 'alpha', context: 'editor' },
          { keys: 'Control+W', command: null, context: 'editor' },
        ],
        'ctrl-w',
        ['editor'],
      ),
    ).toEqual({ commands: [], pending: true })
    expect(
      lookup(
        [
          { keys: 'Control+W ArrowLeft', command: 'alpha', context: 'editor' },
          { keys: 'Control+W', command: 'beta', context: 'editor' },
        ],
        'ctrl-w',
        ['editor'],
      ),
    ).toEqual({ commands: ['beta'], pending: false })
  })

  it('test_simple_disable', () => {
    expect(
      lookup(
        [
          { keys: 'Control+X', command: 'alpha', context: 'editor' },
          { keys: 'Control+X', command: null, context: 'editor' },
        ],
        'ctrl-x',
        ['editor'],
      ),
    ).toEqual({ commands: [], pending: false })
  })

  it('test_disable_weaker_sources_only', () => {
    const editor = ['editor']
    expect(
      lookup(
        [
          { keys: 'Control+X', command: 'alpha', context: 'editor', source: 'default' },
          { keys: 'Control+X', command: null, context: 'editor', source: 'pack' },
        ],
        'ctrl-x',
        editor,
      ).commands,
    ).toEqual([])
    expect(
      lookup(
        [
          { keys: 'Control+X', command: null, context: 'editor', source: 'default' },
          { keys: 'Control+X', command: null, context: 'editor', source: 'pack' },
          { keys: 'Control+X', command: 'beta', source: 'user' },
        ],
        'ctrl-x',
        editor,
      ).commands,
    ).toEqual(['beta'])
    expect(
      lookup(
        [
          { keys: 'Control+X', command: null, context: 'editor', source: 'pack' },
          { keys: 'Control+X', command: 'beta', context: 'workspace', source: 'user' },
        ],
        'ctrl-x',
        ['workspace', 'editor'],
      ).commands,
    ).toEqual(['beta'])
    expect(
      lookup(
        [
          { keys: 'Control+X', command: 'alpha', context: 'editor', source: 'default' },
          { keys: 'Control+X', command: null, context: 'editor', source: 'base' },
          { keys: 'Control+X', command: 'gamma', context: 'editor', source: 'pack' },
        ],
        'ctrl-x',
        editor,
      ).commands,
    ).toEqual(['gamma'])
    // Source strength decides, not table order: a pack binding listed first still survives.
    expect(
      lookup(
        [
          { keys: 'Control+X', command: 'gamma', context: 'editor', source: 'pack' },
          { keys: 'Control+X', command: 'alpha', context: 'editor', source: 'default' },
          { keys: 'Control+X', command: null, context: 'editor', source: 'base' },
        ],
        'ctrl-x',
        editor,
      ).commands,
    ).toEqual(['gamma'])
    expect(
      lookup(
        [
          { keys: 'Control+X', command: 'alpha', context: 'editor', source: 'default' },
          { keys: 'Control+X', command: 'gamma', context: 'editor', source: 'pack' },
          { keys: 'Control+X', command: null, context: 'editor', source: 'user' },
        ],
        'ctrl-x',
        editor,
      ).commands,
    ).toEqual([])
  })

  it('test_fail_to_disable: a shallower null does not remove a deeper binding', () => {
    expect(
      lookup(
        [
          { keys: 'Control+X', command: 'alpha', context: 'editor' },
          { keys: 'Control+X', command: null, context: 'workspace' },
        ],
        'ctrl-x',
        ['workspace', 'editor'],
      ),
    ).toEqual({ commands: ['alpha'], pending: false })
  })

  it('test_disable_deeper: a deeper null removes a shallower binding', () => {
    expect(
      lookup(
        [
          { keys: 'Control+X', command: 'alpha', context: 'workspace' },
          { keys: 'Control+X', command: null, context: 'editor' },
        ],
        'ctrl-x',
        ['workspace', 'editor'],
      ),
    ).toEqual({ commands: [], pending: false })
  })

  const vimStack = ['Workspace', 'Pane', 'Editor vim_mode=normal']

  it('test_pending_match_enabled: a bound prefix with a later chord is pending with a binding', () => {
    expect(
      lookup(
        [
          { keys: 'Control+X', command: 'beta', context: 'vim_mode == normal' },
          { keys: 'Control+X 0', command: 'alpha', context: 'Workspace' },
        ],
        'ctrl-x',
        vimStack,
      ),
    ).toEqual({ commands: ['beta'], pending: true })
  })

  it('test_pending_match_enabled_extended: a null chord is not pending', () => {
    expect(
      lookup(
        [
          { keys: 'Control+X', command: 'beta', context: 'vim_mode == normal' },
          { keys: 'Control+X 0', command: null, context: 'Workspace' },
        ],
        'ctrl-x',
        vimStack,
      ),
    ).toEqual({ commands: ['beta'], pending: false })
    expect(
      lookup(
        [
          { keys: 'Control+X', command: 'beta', context: 'Workspace' },
          { keys: 'Control+X 0', command: null, context: 'vim_mode == normal' },
        ],
        'ctrl-x',
        vimStack,
      ),
    ).toEqual({ commands: ['beta'], pending: false })
  })

  it('test_overriding_prefix: a prefix binding defined after the chord shadows it', () => {
    expect(
      lookup(
        [
          { keys: 'Control+X 0', command: 'alpha', context: 'Workspace' },
          { keys: 'Control+X', command: 'beta', context: 'vim_mode == normal' },
        ],
        'ctrl-x',
        vimStack,
      ),
    ).toEqual({ commands: ['beta'], pending: false })
  })

  it('test_context_precedence_with_same_source', () => {
    expect(
      lookup(
        [
          { keys: 'Meta+R', command: 'alpha', context: 'Workspace' },
          { keys: 'Meta+R', command: 'beta', context: 'Editor' },
        ],
        'cmd-r',
        ['Workspace', 'Editor'],
      ).commands,
    ).toEqual(['beta', 'alpha'])
  })

  it('an unbind removes one command from the keys and leaves the others', () => {
    const entries: KeymapEntry[] = [
      { keys: 'Control+B', command: 'sidebar.toggle', context: 'Workspace', source: 'default' },
      { keys: 'Control+B', command: 'markdown.bold', context: 'Editor', source: 'default' },
      { keys: 'Control+B', unbind: 'markdown.bold', context: 'Editor', source: 'user' },
    ]
    expect(lookup(entries, 'ctrl-b', ['Workspace', 'Editor']).commands).toEqual(['sidebar.toggle'])
  })

  it('source outranks table order at equal depth', () => {
    const entries: KeymapEntry[] = [
      { keys: 'Control+P', command: 'mine', source: 'user' },
      { keys: 'Control+P', command: 'default', source: 'default' },
    ]
    expect(lookup(entries, 'ctrl-p', ['Workspace']).commands).toEqual(['mine', 'default'])
  })
})
