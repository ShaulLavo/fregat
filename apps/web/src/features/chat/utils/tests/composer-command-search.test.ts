import type { ProviderSkill, ProviderSlashCommand } from '@workspace/contracts'

import { expect, test } from '../../../../../test/fixtures'

import {
  searchComposerCommands,
  searchComposerSkills,
} from '@/features/chat/utils/composer-command-search'

const COMMANDS: ProviderSlashCommand[] = [
  { description: 'Preview the rendered output', name: 'preview' },
  { aliases: ['stats'], description: 'Show token usage', name: 'usage' },
  { argumentHint: '<path>', description: 'Review a file', name: 'review' },
  { description: 'Undo the last review', name: 'undo' },
]

const SKILLS: ProviderSkill[] = [
  { description: 'Read and edit PDF files', enabled: true, name: 'pdf' },
  { description: 'Build slide decks', enabled: false, name: 'pptx' },
  {
    description: 'Review UI code against the guidelines',
    enabled: true,
    name: 'web-design',
    scope: 'anthropic-skills',
  },
]

function names(commands: readonly ProviderSlashCommand[]) {
  return commands.map((command) => command.name)
}

test('a prefix match outranks a substring match, which outranks a weaker field', () => {
  // `review` starts with it, `preview` only contains it, and `undo` has it in
  // its description alone.
  expect(names(searchComposerCommands(COMMANDS, 'rev'))).toEqual(['review', 'preview', 'undo'])
})

test('a scattered name match still outranks a perfect description match', () => {
  // `preview` matches `review` only as a subsequence; `undo` says the whole word
  // in its description. The name field wins anyway.
  expect(names(searchComposerCommands(COMMANDS, 'review'))).toEqual(['review', 'preview', 'undo'])
})

test('the trigger character is not part of the query', () => {
  expect(names(searchComposerCommands(COMMANDS, '/rev'))).toEqual(
    names(searchComposerCommands(COMMANDS, 'rev')),
  )
  expect(searchComposerSkills(SKILLS, '$pdf').map((skill) => skill.name)).toEqual(['pdf'])
})

test('aliases match, and rank behind the name they alias', () => {
  expect(names(searchComposerCommands(COMMANDS, 'stats'))).toEqual(['usage'])
})

test('every token has to match something', () => {
  expect(names(searchComposerCommands(COMMANDS, 'review nonsense'))).toEqual([])
  expect(names(searchComposerCommands(COMMANDS, 'review file'))).toEqual(['review'])
})

test('an empty query keeps the provider order', () => {
  expect(names(searchComposerCommands(COMMANDS, '   '))).toEqual(names(COMMANDS))
})

test('ties keep input order rather than reshuffling', () => {
  const tied: ProviderSlashCommand[] = [
    { description: 'Format the code', name: 'zzz-one' },
    { description: 'Format the code', name: 'zzz-two' },
  ]

  expect(names(searchComposerCommands(tied, 'format'))).toEqual(['zzz-one', 'zzz-two'])
  expect(names(searchComposerCommands(tied.toReversed(), 'format'))).toEqual(['zzz-two', 'zzz-one'])
})

test('the limit cuts the ranked list, not the input', () => {
  expect(names(searchComposerCommands(COMMANDS, 'rev', 1))).toEqual(['review'])
  expect(names(searchComposerCommands(COMMANDS, '', 2))).toEqual(['preview', 'usage'])
})

test('skills that the provider cannot run are not offerable', () => {
  expect(searchComposerSkills(SKILLS, '').map((skill) => skill.name)).toEqual(['pdf', 'web-design'])
  expect(searchComposerSkills(SKILLS, 'ppt')).toEqual([])
})

test('a skill matches on its scope and its description', () => {
  expect(searchComposerSkills(SKILLS, 'anthropic').map((skill) => skill.name)).toEqual([
    'web-design',
  ])
  expect(searchComposerSkills(SKILLS, 'guidelines').map((skill) => skill.name)).toEqual([
    'web-design',
  ])
})

test('long composer hits stay within their tier and field', () => {
  const prefix = `rev${'x'.repeat(300)}`
  const boundary = `${'x'.repeat(300)}-rev`
  const includes = `${'x'.repeat(300)}rev`
  const fuzzy = `r${'x'.repeat(300)}e${'x'.repeat(300)}v`
  const commands = [
    { name: 'alias-only', aliases: ['rev'] },
    { name: fuzzy },
    { name: includes },
    { name: boundary },
    { name: prefix },
  ]
  expect(names(searchComposerCommands(commands, 'rev'))).toEqual([
    prefix,
    boundary,
    includes,
    fuzzy,
    'alias-only',
  ])
})

test.each([':', '.'])('composer treats %s as a word boundary', (separator) => {
  const boundary = `x${separator}rev`
  expect(names(searchComposerCommands([{ name: 'aarev' }, { name: boundary }], 'rev'))).toEqual([
    boundary,
    'aarev',
  ])
})
