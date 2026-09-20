import { providerInstanceIdSchema, type ProviderCommandCatalog } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'
import * as v from 'valibot'

import {
  chatInputCommandItems,
  chatInputLineBoundaryOffset,
  chatInputMentionCommandItems,
  chatInputRangeReplacement,
  chatInputStandaloneSlashCommand,
  chatInputSurroundClose,
  detectChatInputTrigger,
  groupChatInputCommandItems,
  searchChatInputSlashCommands,
} from '@/features/chat/utils/input-logic'

describe('chat input logic', () => {
  it('detects slash commands at the start of the current line', () => {
    expect(detectChatInputTrigger('/pl', 3)).toEqual({
      kind: 'slash-command',
      query: 'pl',
      rangeEnd: 3,
      rangeStart: 0,
      text: '/pl',
    })
    expect(detectChatInputTrigger('hello\n/de', 9)).toEqual({
      kind: 'slash-command',
      query: 'de',
      rangeEnd: 9,
      rangeStart: 6,
      text: '/de',
    })
  })

  it('detects mentions in the current token only', () => {
    expect(detectChatInputTrigger('open @src/app', 13)).toEqual({
      kind: 'mention',
      query: 'src/app',
      rangeEnd: 13,
      rangeStart: 5,
      text: '@src/app',
    })
    expect(detectChatInputTrigger('email user@example.com', 18)).toBeNull()
  })

  it('keeps a quoted mention triggered across the spaces inside the path', () => {
    expect(detectChatInputTrigger('open @"src/my fi', 16)).toEqual({
      kind: 'mention',
      query: 'src/my fi',
      rangeEnd: 16,
      rangeStart: 5,
      text: '@"src/my fi',
    })
    // Once the quote closes the mention is finished, so the menu lets go.
    expect(detectChatInputTrigger('open @"src/my file.ts"', 22)).toBeNull()
  })

  it('serializes a mention path that could not otherwise be read back', () => {
    expect(
      chatInputMentionCommandItems([
        { id: 'path:plain', label: 'app.tsx', path: 'src/app.tsx', type: 'file' },
        { id: 'path:spaced', label: 'my file.ts', path: 'src/my file.ts', type: 'file' },
      ]).map((item) => item.replacement),
    ).toEqual(['@src/app.tsx ', '@"src/my file.ts" '])
  })

  it('replaces a trigger range and swallows the space the prompt already had', () => {
    expect(
      chatInputRangeReplacement({
        rangeEnd: 8,
        rangeStart: 5,
        replacement: '@src/app.ts ',
        text: 'read @ap now',
      }),
    ).toEqual({
      cursor: 17,
      rangeEnd: 9,
      rangeStart: 5,
      text: 'read @src/app.ts now',
    })
  })

  it('keeps a replacement that carries no trailing blank away from the next character', () => {
    expect(
      chatInputRangeReplacement({
        rangeEnd: 8,
        rangeStart: 5,
        replacement: '@src/app.ts',
        text: 'read @ap now',
      })?.text,
    ).toBe('read @src/app.ts now')
  })

  it('refuses a replacement whose range no longer covers the trigger it was made for', () => {
    expect(
      chatInputRangeReplacement({
        expectedText: '@ap',
        rangeEnd: 8,
        rangeStart: 5,
        replacement: '@src/app.ts ',
        text: 'read @src/app.ts now',
      }),
    ).toBeNull()
  })

  it('resolves line boundaries against the logical line the caret sits on', () => {
    const text = 'first line\nsecond line'

    expect(chatInputLineBoundaryOffset(text, 22, 'start')).toBe(11)
    expect(chatInputLineBoundaryOffset(text, 11, 'end')).toBe(22)
    expect(chatInputLineBoundaryOffset(text, 4, 'start')).toBe(0)
    expect(chatInputLineBoundaryOffset(text, 4, 'end')).toBe(10)
    expect(chatInputLineBoundaryOffset('\nsecond', 0, 'start')).toBe(0)
  })

  it('pairs surround symbols and ignores everything else', () => {
    expect(chatInputSurroundClose('(')).toBe(')')
    expect(chatInputSurroundClose('`')).toBe('`')
    expect(chatInputSurroundClose('a')).toBeNull()
  })

  it('keeps a finished slash command triggered through its trailing blanks', () => {
    expect(detectChatInputTrigger('/plan ', 6)).toEqual({
      kind: 'slash-command',
      query: 'plan',
      rangeEnd: 6,
      rangeStart: 0,
      text: '/plan ',
    })
    // Prose after the command is a message, not a command.
    expect(detectChatInputTrigger('/plan ship it', 13)).toBeNull()
  })

  it('resolves a prompt that is only a slash command, spaced or not', () => {
    expect(chatInputStandaloneSlashCommand('/plan')).toBe('plan')
    expect(chatInputStandaloneSlashCommand('/plan ')).toBe('plan')
    expect(chatInputStandaloneSlashCommand('/PLAN\n')).toBe('plan')
    expect(chatInputStandaloneSlashCommand('/default ')).toBe('default')
    expect(chatInputStandaloneSlashCommand('/plan ship it')).toBeNull()
    expect(chatInputStandaloneSlashCommand('plan')).toBeNull()
  })

  it('filters slash commands by query', () => {
    expect(searchChatInputSlashCommands('pla').map((item) => item.id)).toEqual(['slash-plan'])
  })

  it('keeps entry types for mention icons', () => {
    expect(
      chatInputMentionCommandItems([
        { id: 'path:src', label: 'src', path: 'src', type: 'directory' },
        { id: 'path:app.tsx', label: 'app.tsx', path: 'src/app.tsx', type: 'file' },
      ]),
    ).toMatchObject([
      { entryType: 'directory', type: 'mention' },
      { entryType: 'file', type: 'mention' },
    ])
  })

  it('omits sensitive-looking paths from mention suggestions', () => {
    const items = chatInputMentionCommandItems([
      { id: 'path:.env.local', label: '.env.local', path: '.env.local', type: 'file' },
      {
        id: 'path:token.json',
        label: 'token.json',
        path: 'config/token.json',
        type: 'file',
      },
      {
        id: 'path:id_rsa.pub',
        label: 'id_rsa.pub',
        path: '.ssh/id_rsa.pub',
        type: 'file',
      },
      {
        id: 'path:api-key.txt',
        label: 'api-key.txt',
        path: 'docs/api-key.txt',
        type: 'file',
      },
      {
        id: 'path:tokenizer.ts',
        label: 'tokenizer.ts',
        path: 'src/tokenizer.ts',
        type: 'file',
      },
      { id: 'path:app.tsx', label: 'app.tsx', path: 'src/app.tsx', type: 'file' },
    ])

    expect(items.map((item) => (item.type === 'mention' ? item.path : null))).toEqual([
      'src/tokenizer.ts',
      'src/app.tsx',
    ])
  })
})

describe('provider-backed composer menus', () => {
  const catalog: ProviderCommandCatalog = {
    commands: [
      { argumentHint: '<path>', description: 'Review a file', name: 'review' },
      { description: 'Summarize the conversation', name: 'summarize' },
    ],
    providerInstanceId: v.parse(providerInstanceIdSchema, 'codex'),
    skills: [
      { description: 'Scan for tech debt', enabled: true, name: 'desloppify', scope: 'repo' },
      { description: 'Never offered', enabled: false, name: 'disabled-skill', scope: 'repo' },
    ],
    supported: true,
  } as ProviderCommandCatalog

  it('opens a skill menu on a $ token at a word boundary', () => {
    expect(detectChatInputTrigger('use $des', 8)).toEqual({
      kind: 'skill',
      query: 'des',
      rangeEnd: 8,
      rangeStart: 4,
      text: '$des',
    })
    expect(detectChatInputTrigger('$', 1)?.kind).toBe('skill')
  })

  it('leaves prices and shell variables alone', () => {
    // `$5.00` and `x$y` are not skill invocations; opening a menu over them
    // would fight the user on ordinary text.
    expect(detectChatInputTrigger('costs 5$5', 9)?.kind).not.toBe('skill')
    expect(detectChatInputTrigger('echo x$HOME', 11)?.kind).not.toBe('skill')
  })

  it('ends the skill token at the first blank', () => {
    expect(detectChatInputTrigger('use $desloppify now', 19)).toBeNull()
  })

  it('offers the provider’s skills, never the disabled ones', () => {
    const items = chatInputCommandItems(detectChatInputTrigger('$', 1), [], catalog, true)

    // A disabled skill committed into the prompt is a name the provider will
    // not resolve, so it is dropped rather than ranked last.
    expect(items.map((item) => item.label)).toEqual(['$desloppify'])
    expect(items[0]?.replacement).toBe('$desloppify ')
  })

  it('lists built-in modes ahead of the provider’s commands', () => {
    const items = chatInputCommandItems(detectChatInputTrigger('/', 1), [], catalog, true)

    expect(items.map((item) => item.label)).toEqual(['/default', '/plan', '/review', '/summarize'])
    expect(groupChatInputCommandItems(items, 'slash-command').map((group) => group.label)).toEqual([
      'Built-in',
      'Provider',
    ])
  })

  it('ranks both menus by what has been typed', () => {
    const commands = chatInputCommandItems(detectChatInputTrigger('/rev', 4), [], catalog, true)
    const skills = chatInputCommandItems(detectChatInputTrigger('$slop', 5), [], catalog, true)

    // Ranked, not filtered: the search is fuzzy, so a weaker match stays on the
    // list behind the one the user is plainly typing.
    expect(commands[0]?.label).toBe('/review')
    expect(skills.map((item) => item.label)).toEqual(['$desloppify'])
  })

  it('hides built-in mode commands without suppressing provider commands', () => {
    expect(
      chatInputCommandItems(detectChatInputTrigger('/', 1), [], catalog, false).map(
        (item) => item.label,
      ),
    ).toEqual(['/review', '/summarize'])
  })

  it('offers only the built-ins when the provider cannot answer', () => {
    const unsupported = { ...catalog, supported: false }

    expect(
      chatInputCommandItems(detectChatInputTrigger('/', 1), [], unsupported, true),
    ).toHaveLength(2)
    expect(chatInputCommandItems(detectChatInputTrigger('$', 1), [], unsupported, true)).toEqual([])
    expect(chatInputCommandItems(detectChatInputTrigger('$', 1), [], null, true)).toEqual([])
  })
})
