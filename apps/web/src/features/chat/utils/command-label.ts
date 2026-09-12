// Adapted from T3code commandLabel.ts. Copyright (c) 2026 T3 Tools Inc.
// MIT license: command-label.LICENSE
type CommandWrapper = 'env' | 'sudo'
type CommandProgramContext = 'exec' | 'shell'

const MAX_COMMAND_SEGMENTS = 64

const SHELL_PROGRAMS = new Set(['sh', 'bash', 'zsh', 'dash', 'ash', 'ksh', 'fish'])
const WINDOWS_SHELL_PROGRAMS = new Set([
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
])
const SHELL_OPTIONS_WITH_VALUE = new Set(['-o', '-O', '--rcfile', '--init-file'])
const SHELL_COMMAND_WRAPPERS = new Set(['builtin', 'command', 'exec'])
const SHELL_PRECOMMAND_MODIFIERS = new Set(['nocorrect', 'noglob', 'time'])
const POWERSHELL_SETUP_PROGRAMS = new Set(['pop-location', 'push-location', 'set-location'])
const POWERSHELL_FLAGS = new Set(['-mta', '-nologo', '-noninteractive', '-noprofile', '-sta'])
const POWERSHELL_OPTIONS_WITH_VALUE = new Set([
  '-configurationname',
  '-executionpolicy',
  '-inputformat',
  '-outputformat',
  '-version',
  '-windowstyle',
  '-workingdirectory',
])
const START_PROCESS_FLAGS = new Set([
  '-confirm',
  '-debug',
  '-loaduserprofile',
  '-nonewwindow',
  '-passthru',
  '-usenewenvironment',
  '-verbose',
  '-wait',
  '-whatif',
])
const START_PROCESS_OPTIONS_WITH_VALUE = new Set([
  '-argumentlist',
  '-credential',
  '-environment',
  '-erroraction',
  '-errorvariable',
  '-informationaction',
  '-informationvariable',
  '-outbuffer',
  '-outvariable',
  '-pipelinevariable',
  '-progressaction',
  '-redirectstandarderror',
  '-redirectstandardinput',
  '-redirectstandardoutput',
  '-verb',
  '-warningaction',
  '-warningvariable',
  '-windowstyle',
  '-workingdirectory',
])
const SKIPPABLE_SUDO_PROBES = new Set(['[', '[[', 'test', 'true'])
const NON_PROGRAM_PREFIX_CHARACTERS = '<>(){}[];|&$`#!%@:'
const NON_PROGRAM_SUFFIX_CHARACTERS = '){]}`'

// Shell control flow cannot reliably identify the executable that will run.
const NON_DESCRIPTIVE_SHELL_PROGRAMS = new Set([
  '!',
  '#',
  '.',
  ':',
  '[',
  '[[',
  'alias',
  'and',
  'autoload',
  'begin',
  'bg',
  'bind',
  'bindkey',
  'break',
  'builtin',
  'caller',
  'case',
  'catch',
  'cd',
  'command',
  'compgen',
  'complete',
  'compopt',
  'continue',
  'coproc',
  'declare',
  'dirs',
  'disown',
  'do',
  'done',
  'elif',
  'else',
  'enable',
  'end',
  'esac',
  'eval',
  'exec',
  'exit',
  'export',
  'false',
  'fc',
  'fg',
  'fi',
  'finally',
  'for',
  'foreach',
  'function',
  'getopts',
  'history',
  'if',
  'in',
  'jobs',
  'let',
  'local',
  'logout',
  'mapfile',
  'nocorrect',
  'noglob',
  'not',
  'or',
  'popd',
  'pushd',
  'read',
  'readarray',
  'readonly',
  'repeat',
  'return',
  'select',
  'set',
  'setopt',
  'shift',
  'shopt',
  'source',
  'switch',
  'suspend',
  'test',
  'then',
  'time',
  'times',
  'trap',
  'try',
  'true',
  'type',
  'typeset',
  'ulimit',
  'umask',
  'unalias',
  'until',
  'unset',
  'unsetopt',
  'wait',
  'while',
])

// Unlike setup builtins, these can make later segments part of control flow or
// otherwise unreachable, so do not use a later program as the command label.
const TERMINAL_SHELL_PROGRAMS = new Set([
  'and',
  'begin',
  'break',
  'case',
  'catch',
  'continue',
  'coproc',
  'do',
  'done',
  'elif',
  'else',
  'end',
  'esac',
  'eval',
  'exec',
  'exit',
  'false',
  'fi',
  'finally',
  'for',
  'foreach',
  'function',
  'if',
  'in',
  'not',
  'or',
  'repeat',
  'return',
  'select',
  'switch',
  'then',
  'try',
  'until',
  'while',
])

function shellCommandArgumentIndex(tokens: ReadonlyArray<string>, start: number): number | null {
  for (let index = start; index < tokens.length; index += 1) {
    const option = tokens[index]!
    if (option === '--' || !option.startsWith('-')) return null
    if (SHELL_OPTIONS_WITH_VALUE.has(option)) {
      index += 1
      continue
    }
    if (option === '--command' || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(option)) return index + 1
  }
  return null
}

const COMMAND_WRAPPER_OPTIONS_WITH_VALUE: Record<CommandWrapper, ReadonlySet<string>> = {
  env: new Set(['-C', '--chdir', '-S', '--split-string', '-u', '--unset']),
  sudo: new Set(['-C', '--close-from', '-D', '--chdir', '-g', '--group', '-u', '--user']),
}

const COMMAND_WRAPPER_FLAGS: Record<CommandWrapper, ReadonlySet<string>> = {
  env: new Set(['-0', '--null', '-i', '--ignore-environment', '--debug', '-v']),
  sudo: new Set(['-A', '--askpass', '-b', '--background', '-E', '-H', '-i', '-n', '-S']),
}

type ShellTokenState = {
  tokens: string[]
  current: string
  quote: '"' | "'" | null
  escaping: boolean
  inBackticks: boolean
  substitutionDepth: number
  parameterExpansionDepth: number
  tokenStarted: boolean
}
function tokenizeShellCommand(command: string): string[] | null {
  const state: ShellTokenState = {
    tokens: [],
    current: '',
    quote: null,
    escaping: false,
    inBackticks: false,
    substitutionDepth: 0,
    parameterExpansionDepth: 0,
    tokenStarted: false,
  }
  const input = command.trim()

  for (let index = 0; index < input.length; index += 1) {
    const next = appendShellTokenCharacter(state, input, index)
    index = next
  }

  if (
    state.quote !== null ||
    state.escaping ||
    state.inBackticks ||
    state.substitutionDepth > 0 ||
    state.parameterExpansionDepth > 0
  ) {
    return null
  }
  if (state.tokenStarted) state.tokens.push(state.current)
  return state.tokens
}

function appendShellTokenCharacter(state: ShellTokenState, input: string, index: number): number {
  const character = input[index]!
  if (state.escaping) {
    state.current += character
    state.escaping = false
    state.tokenStarted = true
    return index
  }
  if (character === '\\' && state.quote !== "'") {
    const nextCharacter = input[index + 1]
    const isWindowsPath =
      state.quote === null && /^(?:[A-Za-z]:|\.{1,2})(?:\\[^\s]*)?$/u.test(state.current)
    if (
      (state.quote === '"' || isWindowsPath) &&
      nextCharacter !== undefined &&
      nextCharacter !== '"' &&
      nextCharacter !== '\\' &&
      nextCharacter !== '$' &&
      nextCharacter !== '`' &&
      nextCharacter !== '\n'
    ) {
      state.current += character
      state.tokenStarted = true
      return index
    }
    state.escaping = true
    state.tokenStarted = true
    return index
  }
  if (state.inBackticks) {
    state.current += character
    if (character === '`') state.inBackticks = false
    state.tokenStarted = true
    return index
  }
  if (state.quote !== null) {
    if (character === state.quote) {
      state.quote = null
    } else {
      state.current += character
    }
    state.tokenStarted = true
    return index
  }
  if (character === '`') {
    state.current += character
    state.inBackticks = true
    state.tokenStarted = true
    return index
  }
  if (character === '$' && input[index + 1] === '{') {
    state.current += '${'
    state.parameterExpansionDepth += 1
    state.tokenStarted = true
    index += 1
    return index
  }
  if (character === '{' && state.parameterExpansionDepth > 0) {
    state.current += character
    state.parameterExpansionDepth += 1
    state.tokenStarted = true
    return index
  }
  if (character === '}' && state.parameterExpansionDepth > 0) {
    state.current += character
    state.parameterExpansionDepth -= 1
    state.tokenStarted = true
    return index
  }
  if (character === '$' && input[index + 1] === '(') {
    state.current += '$('
    state.substitutionDepth += 1
    state.tokenStarted = true
    index += 1
    return index
  }
  if (character === '(') {
    state.current += character
    state.substitutionDepth += 1
    state.tokenStarted = true
    return index
  }
  if (character === ')' && state.substitutionDepth > 0) {
    state.current += character
    state.substitutionDepth -= 1
    state.tokenStarted = true
    return index
  }
  if (character === '"' || character === "'") {
    state.quote = character
    state.tokenStarted = true
    return index
  }
  if (/\s/u.test(character)) {
    if (state.substitutionDepth > 0 || state.parameterExpansionDepth > 0) {
      state.current += character
      state.tokenStarted = true
      return index
    }
    if (state.tokenStarted) {
      state.tokens.push(state.current)
      state.current = ''
      state.tokenStarted = false
    }
    return index
  }
  state.current += character
  state.tokenStarted = true

  return index
}

type ShellCommandSplit = {
  readonly firstCommand: string
  readonly remainingCommand: string | null
  readonly separator: string | null
}

type Heredoc = {
  readonly delimiter: string
  readonly stripTabs: boolean
}

type ShellSeparator = {
  readonly index: number
  readonly length: number
}

type ShellCommentRange = {
  readonly start: number
  readonly end: number
}

function commandWithoutShellComments(
  command: string,
  end: number,
  comments: ReadonlyArray<ShellCommentRange>,
): string {
  let result = ''
  let cursor = 0
  for (const comment of comments) {
    if (comment.start >= end) break
    result += command.slice(cursor, comment.start)
    cursor = Math.min(comment.end, end)
  }
  return result + command.slice(cursor, end)
}

function readHeredocDelimiter(
  command: string,
  start: number,
  stripTabs: boolean,
): { readonly heredoc: Heredoc; readonly end: number } | null {
  let index = start
  while (command[index] === ' ' || command[index] === '\t') index += 1

  let delimiter = ''
  let quote: '"' | "'" | null = null
  let escaping = false
  for (; index < command.length; index += 1) {
    const character = command[index]!
    if (escaping) {
      delimiter += character
      escaping = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaping = true
      continue
    }
    if (quote !== null && character === quote) {
      quote = null
      continue
    }
    if (quote !== null) {
      delimiter += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/u.test(character) || ';&|<>()'.includes(character)) break
    delimiter += character
  }

  if (!delimiter || quote !== null || escaping) return null
  return { heredoc: { delimiter, stripTabs }, end: index }
}

function commandAfterHeredocs(
  command: string,
  start: number,
  heredocs: ReadonlyArray<Heredoc>,
): string | null {
  let cursor = start
  for (const heredoc of heredocs) {
    const next = indexAfterHeredoc(command, cursor, heredoc)
    if (next === null) return null
    cursor = next
  }

  return command.slice(cursor).trim() || null
}

function indexAfterHeredoc(command: string, start: number, heredoc: Heredoc): number | null {
  let cursor = start
  while (cursor <= command.length) {
    const newlineIndex = command.indexOf('\n', cursor)
    const lineEnd = newlineIndex === -1 ? command.length : newlineIndex
    const line = command.slice(cursor, lineEnd).replace(/\r$/u, '')
    const comparableLine = heredoc.stripTabs ? line.replace(/^\t+/u, '') : line
    cursor = newlineIndex === -1 ? command.length : newlineIndex + 1
    if (comparableLine === heredoc.delimiter) return cursor
    if (newlineIndex === -1) return null
  }
  return null
}

type ShellSplitState = {
  quote: '"' | "'" | null
  powerShellHereStringQuote: '"' | "'" | null
  escaping: boolean
  inBackticks: boolean
  inComment: boolean
  substitutionDepth: number
  parameterExpansionDepth: number
  heredocs: Heredoc[]
  comments: ShellCommentRange[]
  commentStart: number
  separatorBeforeHeredocs: ShellSeparator | null
}
function splitFirstShellCommand(command: string): ShellCommandSplit {
  const state: ShellSplitState = {
    quote: null,
    powerShellHereStringQuote: null,
    escaping: false,
    inBackticks: false,
    inComment: false,
    substitutionDepth: 0,
    parameterExpansionDepth: 0,
    heredocs: [],
    comments: [],
    commentStart: 0,
    separatorBeforeHeredocs: null,
  }

  for (let index = 0; index < command.length; index += 1) {
    const next = splitAtShellCharacter(state, command, index)
    if (typeof next !== 'number') return next
    index = next
  }

  if (state.inComment) state.comments.push({ start: state.commentStart, end: command.length })
  return {
    firstCommand: commandWithoutShellComments(command, command.length, state.comments).trim(),
    remainingCommand: null,
    separator: null,
  }
}

function splitAtShellCharacter(
  state: ShellSplitState,
  command: string,
  index: number,
): number | ShellCommandSplit {
  const character = command[index]!
  if (state.powerShellHereStringQuote !== null) {
    if (
      character === state.powerShellHereStringQuote &&
      command[index + 1] === '@' &&
      (index === 0 || command[index - 1] === '\n')
    ) {
      state.powerShellHereStringQuote = null
      index += 1
    }
    return index
  }
  if (state.inComment) {
    if (character !== '\n') return index
    state.inComment = false
    state.comments.push({ start: state.commentStart, end: index })
  }
  if (state.escaping) {
    state.escaping = false
    return index
  }
  if (character === '\\' && state.quote !== "'") {
    state.escaping = true
    return index
  }
  if (state.inBackticks) {
    if (character === '`') state.inBackticks = false
    return index
  }
  if (state.quote !== null) {
    if (character === state.quote) state.quote = null
    return index
  }
  const nextCharacter = command[index + 1]
  if (
    character === '@' &&
    (nextCharacter === '"' || nextCharacter === "'") &&
    (command[index + 2] === '\n' || (command[index + 2] === '\r' && command[index + 3] === '\n'))
  ) {
    state.powerShellHereStringQuote = nextCharacter
    index += 1
    return index
  }
  if (character === '"' || character === "'") {
    state.quote = character
    return index
  }
  if (character === '`') {
    state.inBackticks = true
    return index
  }
  if (
    character === '#' &&
    (index === 0 || /\s/u.test(command[index - 1]!) || ';&|('.includes(command[index - 1]!))
  ) {
    state.inComment = true
    state.commentStart = index
    return index
  }
  if (character === '$' && command[index + 1] === '{') {
    state.parameterExpansionDepth += 1
    index += 1
    return index
  }
  if (character === '{' && state.parameterExpansionDepth > 0) {
    state.parameterExpansionDepth += 1
    return index
  }
  if (character === '}' && state.parameterExpansionDepth > 0) {
    state.parameterExpansionDepth -= 1
    return index
  }
  if (character === '(') {
    state.substitutionDepth += 1
    return index
  }
  if (character === ')' && state.substitutionDepth > 0) {
    state.substitutionDepth -= 1
    return index
  }
  if (state.substitutionDepth > 0 || state.parameterExpansionDepth > 0) return index

  if (character === '<' && command[index + 1] === '<' && command[index + 2] !== '<') {
    const stripTabs = command[index + 2] === '-'
    const delimiter = readHeredocDelimiter(command, index + (stripTabs ? 3 : 2), stripTabs)
    if (delimiter === null) {
      return { firstCommand: command.trim(), remainingCommand: null, separator: null }
    }
    state.heredocs.push(delimiter.heredoc)
    index = delimiter.end - 1
    return index
  }

  const isDoubleOperator =
    (character === '&' && command[index + 1] === '&') ||
    (character === '|' && (command[index + 1] === '|' || command[index + 1] === '&'))
  const isRedirectionAmpersand =
    character === '&' &&
    (command[index - 1] === '>' || command[index - 1] === '<' || command[index + 1] === '>')
  if ((!isDoubleOperator && !';&|\n'.includes(character)) || isRedirectionAmpersand) return index

  if (character === '\n' && state.heredocs.length > 0) {
    const separator = state.separatorBeforeHeredocs
    const firstCommand = commandWithoutShellComments(
      command,
      separator?.index ?? index,
      state.comments,
    ).trimStart()
    const commandBeforeHeredocs = separator
      ? command.slice(separator.index + separator.length, index).trim()
      : ''
    const commandFollowingHeredocs = commandAfterHeredocs(command, index + 1, state.heredocs)
    const remainingCommand = [commandBeforeHeredocs, commandFollowingHeredocs]
      .filter((part): part is string => Boolean(part))
      .join('\n')
    return {
      firstCommand,
      remainingCommand: remainingCommand || null,
      separator: separator
        ? command.slice(separator.index, separator.index + separator.length)
        : '\n',
    }
  }
  if (state.heredocs.length > 0) {
    state.separatorBeforeHeredocs ??= {
      index,
      length: isDoubleOperator ? 2 : 1,
    }
    if (isDoubleOperator) index += 1
    return index
  }

  const firstCommand = commandWithoutShellComments(command, index, state.comments).trimStart()
  let nextCommandIndex = index + (isDoubleOperator ? 2 : 1)
  while (/\s/u.test(command[nextCommandIndex] ?? '')) nextCommandIndex += 1
  const nextCommand = command.slice(nextCommandIndex).trim()
  return {
    firstCommand,
    remainingCommand: nextCommand || null,
    separator: isDoubleOperator ? command.slice(index, index + 2) : character,
  }
}

function commandWithoutLeadingShellComments(command: string): string | null {
  let remainingCommand = command.trimStart()
  while (remainingCommand.startsWith('#')) {
    const newlineIndex = remainingCommand.indexOf('\n')
    if (newlineIndex === -1) return null
    remainingCommand = remainingCommand.slice(newlineIndex + 1).trimStart()
  }
  return remainingCommand || null
}

type ShellContinuationState = {
  normalizedCommand: string
  quote: '"' | "'" | null
  escaping: boolean
}
function withoutShellLineContinuations(command: string): string {
  const state: ShellContinuationState = { normalizedCommand: '', quote: null, escaping: false }

  for (let index = 0; index < command.length; index += 1) {
    const next = appendShellLineCharacter(state, command, index)
    index = next
  }

  return state.normalizedCommand
}

function appendShellLineCharacter(
  state: ShellContinuationState,
  command: string,
  index: number,
): number {
  const character = command[index]!
  if (state.escaping) {
    state.normalizedCommand += character
    state.escaping = false
    return index
  }
  if (character === '\\' && state.quote !== "'") {
    if (command[index + 1] === '\n') {
      index += 1
      return index
    }
    if (command[index + 1] === '\r' && command[index + 2] === '\n') {
      index += 2
      return index
    }
    state.normalizedCommand += character
    state.escaping = true
    return index
  }
  if (state.quote !== null) {
    if (character === state.quote) state.quote = null
  } else if (character === '"' || character === "'") {
    state.quote = character
  }
  state.normalizedCommand += character

  return index
}

function indexAfterShellRedirection(tokens: ReadonlyArray<string>, index: number): number | null {
  const token = tokens[index]
  if (!token || /^[<>]\(/u.test(token)) return null
  const match = token.match(
    /^(?:(?:(?:\d+|\*|\{[A-Za-z_][A-Za-z0-9_]*\})?(?:<<<|<<-|<<|<>|>>|>\||<&|>&|<|>))|&>>|&>)(.*)$/u,
  )
  if (!match) return null
  if (match[1]) return index + 1
  return tokens[index + 1] === undefined ? tokens.length + 1 : index + 2
}

function serializeShellTokens(tokens: ReadonlyArray<string>): string {
  return tokens.map((token) => `'${token.replaceAll("'", "'\\''")}'`).join(' ')
}

function transparentWrapperCommandIndex(
  wrapper: string,
  tokens: ReadonlyArray<string>,
  index: number,
): number | null {
  if (wrapper === 'bundle') {
    return tokens[index + 1] === 'exec' && tokens[index + 2] !== undefined ? index + 2 : null
  }

  if (wrapper === 'nohup') {
    let targetIndex = index + 1
    if (tokens[targetIndex] === '--') targetIndex += 1
    const target = tokens[targetIndex]
    return target && !target.startsWith('-') ? targetIndex : null
  }

  if (wrapper === 'script') {
    // BSD `script` takes an output file before the optional command. Requiring
    // an option and both operands avoids guessing about a plain `script file`.
    return /^-[adkpqr]+$/u.test(tokens[index + 1] ?? '') && tokens[index + 3] !== undefined
      ? index + 3
      : null
  }

  if (wrapper === 'arch') {
    if (/^-(?:arm64|arm64e|i386|x86_64)$/u.test(tokens[index + 1] ?? '')) {
      return tokens[index + 2] !== undefined ? index + 2 : null
    }
    return tokens[index + 1] === '-arch' && tokens[index + 3] !== undefined ? index + 3 : null
  }

  if (wrapper === 'timeout' || wrapper === 'gtimeout') {
    return /^(?:\d+(?:\.\d*)?|\.\d+)[smhd]?$/u.test(tokens[index + 1] ?? '') &&
      tokens[index + 2] !== undefined
      ? index + 2
      : null
  }

  return null
}

function staticProgramName(value: string): string | null {
  const trimmedValue = value.trim()
  if (!trimmedValue || /^[A-Za-z][A-Za-z0-9+.-]*:(?![\\/])/u.test(trimmedValue)) return null
  const program = trimmedValue.split(/[\\/]/u).at(-1)
  if (
    !program ||
    (/\s/u.test(program) && !/[\\/]/u.test(trimmedValue)) ||
    NON_PROGRAM_PREFIX_CHARACTERS.includes(program[0] ?? '') ||
    NON_PROGRAM_SUFFIX_CHARACTERS.includes(program.at(-1) ?? '')
  ) {
    return null
  }
  return program
}

function leadingPowerShellLiteral(command: string): string | null {
  const input = command.trimStart()
  const quote = input[0]
  if (quote !== '"' && quote !== "'") return staticProgramName(input.match(/^\S+/u)?.[0] ?? '')

  let value = ''
  for (let index = 1; index < input.length; index += 1) {
    const character = input[index]!
    if (character === '`' && input[index + 1] !== undefined) {
      value += input[index + 1]
      index += 1
      continue
    }
    if (character === quote && quote === "'" && input[index + 1] === "'") {
      value += "'"
      index += 1
      continue
    }
    if (character === quote) return staticProgramName(value)
    value += character
  }
  return null
}

function powerShellCallOperatorProgramName(command: string): string | null | undefined {
  const match = command.match(/^\s*&\s+([\s\S]*)$/u)
  return match ? leadingPowerShellLiteral(match[1]!) : undefined
}

type PowerShellAssignment = {
  readonly matched: boolean
  readonly program: string | null
}

function powerShellAssignmentProgramName(
  command: string,
  depth: number,
  remainingCommand: string | null,
  segmentsRemaining: number,
): PowerShellAssignment {
  const assignment = command.match(
    /^\s*\$(?:(env|global|local|script):)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*([\s\S]*)$/iu,
  )
  if (!assignment) return { matched: false, program: null }

  // Environment assignments are setup. Their right-hand side is a value, not
  // a command, so prefer the next top-level segment when one exists.
  if (assignment[1]?.toLowerCase() === 'env') {
    return {
      matched: true,
      program: remainingCommand
        ? commandProgramNameInternal(remainingCommand, depth, 'shell', segmentsRemaining - 1)
        : null,
    }
  }

  const value = assignment[2]!.trim()
  // The POSIX-oriented segment splitter does not balance PowerShell arrays or
  // hashtables. Do not mistake a key after an internal semicolon for a command.
  if (/^(?:\[ordered\]\s*)?@\s*[{(]/iu.test(value)) {
    return { matched: true, program: null }
  }
  const calledProgram = powerShellCallOperatorProgramName(value)
  if (calledProgram !== undefined) return { matched: true, program: calledProgram }

  const directCommand = value.match(/^(?:@?\(\s*)?([A-Za-z][A-Za-z0-9_.-]*)\b/u)?.[1]
  if (directCommand && !NON_DESCRIPTIVE_SHELL_PROGRAMS.has(directCommand.toLowerCase())) {
    const parsedCommand = commandProgramNameInternal(value, depth + 1, 'shell', segmentsRemaining)
    return { matched: true, program: parsedCommand ?? directCommand }
  }

  return {
    matched: true,
    program: remainingCommand
      ? commandProgramNameInternal(remainingCommand, depth, 'shell', segmentsRemaining - 1)
      : null,
  }
}

type WindowsShellPayload = {
  readonly matched: boolean
  readonly program: string | null
}

function windowsShellPayloadProgramName(
  shell: string,
  tokens: ReadonlyArray<string>,
  start: number,
  depth: number,
  remainingCommand: string | null,
  separator: string | null,
  segmentsRemaining: number,
): WindowsShellPayload {
  const parsePayload = (payload: string | undefined): string | null => {
    if (!payload) return null
    const command =
      remainingCommand && separator ? `${payload} ${separator} ${remainingCommand}` : payload
    return commandProgramNameInternal(command, depth + 1, 'shell', segmentsRemaining)
  }

  if (shell === 'cmd' || shell === 'cmd.exe') {
    const index = tokens.findIndex(
      (option, index) =>
        index >= start && (option.toLowerCase() === '/c' || option.toLowerCase() === '/k'),
    )
    if (index < 0) return { matched: false, program: null }
    return { matched: true, program: parsePayload(tokens[index + 1]) }
  }

  for (let index = start; index < tokens.length; index += 1) {
    const option = tokens[index]!.toLowerCase()
    if (option === '-command' || option === '-c') {
      const payload = tokens[index + 1]
      return {
        matched: true,
        program: parsePayload(payload),
      }
    }
    if (option === '-file' || option === '-f') {
      return { matched: true, program: staticProgramName(tokens[index + 1] ?? '') }
    }
    if (option === '-encodedcommand' || option === '-enc' || option === '-e') {
      return { matched: true, program: null }
    }
    if (POWERSHELL_OPTIONS_WITH_VALUE.has(option)) {
      index += 1
      continue
    }
    if (POWERSHELL_FLAGS.has(option)) continue
    if (!option.startsWith('-')) {
      return { matched: true, program: staticProgramName(tokens[index]!) }
    }
  }
  return { matched: false, program: null }
}

function startProcessProgramName(tokens: ReadonlyArray<string>, start: number): string | null {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const option = token.toLowerCase()
    if (option === '-filepath') return staticProgramName(tokens[index + 1] ?? '')
    if (START_PROCESS_FLAGS.has(option)) continue
    if (START_PROCESS_OPTIONS_WITH_VALUE.has(option) && tokens[index + 1] === undefined) return null
    if (START_PROCESS_OPTIONS_WITH_VALUE.has(option)) {
      index += 1
      continue
    }
    if (token.startsWith('-')) return null
    return staticProgramName(token)
  }
  return null
}

function literalAssignmentProgram(
  token: string,
): { readonly name: string; readonly program: string | null } | null {
  const assignment = token.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/su)
  if (!assignment) return null
  const name = assignment[1]!
  let value = assignment[2]!.trim()
  if (!value || /[$`]/u.test(value)) return { name, program: null }

  if (value.startsWith('(') && value.endsWith(')')) {
    const arrayTokens = tokenizeShellCommand(value.slice(1, -1))
    value = arrayTokens?.[0] ?? ''
  } else if (/\s/u.test(value) && !/[\\/]/u.test(value)) {
    return { name, program: null }
  }

  return { name, program: staticProgramName(value) }
}

function referencedCommandAlias(token: string): string | null {
  const reference = token.match(
    /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)(?:\[@\])?\})$/u,
  )
  return reference?.[1] ?? reference?.[2] ?? null
}

// Resolve static shell aliases without evaluating their expansions.
function literalCommandAliasProgramName(command: string): string | null {
  const aliases = new Map<string, string>()
  let remainingCommand: string | null = command
  let controlFlowDepth = 0

  for (let segmentCount = 0; remainingCommand && segmentCount < 64; segmentCount += 1) {
    const commandWithoutComments = commandWithoutLeadingShellComments(remainingCommand)
    if (commandWithoutComments === null) return null
    const commandSplit = splitFirstShellCommand(commandWithoutComments)
    const tokens = tokenizeShellCommand(withoutShellLineContinuations(commandSplit.firstCommand))
    if (tokens === null) return null

    const commandIndex = aliasCommandIndex(tokens)

    const aliasName = referencedCommandAlias(tokens[commandIndex] ?? '')
    const aliasedProgram = aliasName ? aliases.get(aliasName) : undefined
    if (aliasedProgram) return aliasedProgram

    const leadingToken = tokens[0]
    if (leadingToken === 'fi' || leadingToken === 'done' || leadingToken === 'esac') {
      controlFlowDepth = Math.max(0, controlFlowDepth - 1)
    }
    if (
      leadingToken === 'if' ||
      leadingToken === 'for' ||
      leadingToken === 'while' ||
      leadingToken === 'until' ||
      leadingToken === 'select' ||
      leadingToken === 'case'
    ) {
      controlFlowDepth += 1
    }

    if (controlFlowDepth === 0) updateLiteralAliases(aliases, tokens)

    remainingCommand = commandSplit.remainingCommand
  }

  return null
}

function wrappedShellCommandProgramName(
  wrapper: string,
  tokens: ReadonlyArray<string>,
  start: number,
  depth: number,
  remainingCommand: string | null,
  segmentsRemaining: number,
): string | null {
  const index = shellWrapperTargetIndex(wrapper, tokens, start)
  if (index === null) return null

  const wrappedTokens = tokens.slice(index)
  if (wrappedTokens.length === 0) return null
  let targetIndex = 0
  while (targetIndex < wrappedTokens.length) {
    const indexAfterRedirection = indexAfterShellRedirection(wrappedTokens, targetIndex)
    if (indexAfterRedirection === null || indexAfterRedirection > wrappedTokens.length) break
    targetIndex = indexAfterRedirection
  }
  const target = wrappedTokens[targetIndex]
  if (target && /^[A-Za-z_][A-Za-z0-9_]*\+?=/u.test(target)) return null

  const wrappedProgram = commandProgramNameInternal(
    serializeShellTokens(wrappedTokens),
    depth + 1,
    wrapper === 'exec' ? 'exec' : 'shell',
    segmentsRemaining,
  )
  if (wrappedProgram !== null) return wrappedProgram

  if (
    wrapper !== 'exec' &&
    target &&
    target === target.toLowerCase() &&
    NON_DESCRIPTIVE_SHELL_PROGRAMS.has(target) &&
    !TERMINAL_SHELL_PROGRAMS.has(target) &&
    remainingCommand
  ) {
    return commandProgramNameInternal(remainingCommand, depth, 'shell', segmentsRemaining - 1)
  }
  return null
}

type CommandProgramState = {
  index: number
  wrapper: CommandWrapper | null
  executionContext: CommandProgramContext
  sawAssignment: boolean
  sawRedirection: boolean
}
function parseCommandProgramName(
  command: string,
  depth: number,
  context: CommandProgramContext,
  segmentsRemaining: number,
): string | null {
  if (depth >= 8 || segmentsRemaining <= 0) return null
  const commandWithoutComments = commandWithoutLeadingShellComments(command)
  if (commandWithoutComments === null) return null
  if (
    /^(?:catch|finally|for|foreach|function|if|param|switch|try|while)\s*[{(]/iu.test(
      commandWithoutComments,
    )
  ) {
    return null
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)\s*\{/u.test(commandWithoutComments)) return null
  // `&&` and `||` inside a `[[ ... ]]` expression are not top-level command
  // separators. Keep the label conservative instead of scanning the test body.
  if (commandWithoutComments.startsWith('[[')) return null
  const commandSplit = splitFirstShellCommand(commandWithoutComments)
  if (/^@["'](?:\r?\n)/u.test(commandSplit.firstCommand.trimStart())) {
    return commandSplit.remainingCommand
      ? commandProgramNameInternal(
          commandSplit.remainingCommand,
          depth,
          'shell',
          segmentsRemaining - 1,
        )
      : null
  }
  const powerShellAssignment = powerShellAssignmentProgramName(
    commandSplit.firstCommand,
    depth,
    commandSplit.remainingCommand,
    segmentsRemaining,
  )
  if (powerShellAssignment.matched) return powerShellAssignment.program
  const windowsPath = commandSplit.firstCommand.match(
    /^\s*((?:\.{1,2}|%[A-Za-z_][A-Za-z0-9_]*%|\$env:[A-Za-z_][A-Za-z0-9_]*)\\\S+)/iu,
  )?.[1]
  if (windowsPath) return staticProgramName(windowsPath)
  const tokens = tokenizeShellCommand(withoutShellLineContinuations(commandSplit.firstCommand))
  if (tokens === null) return null
  const firstCharacter = commandSplit.firstCommand.trimStart()[0]
  if (
    tokens.length === 1 &&
    (firstCharacter === '"' || firstCharacter === "'") &&
    /[\s()=]/u.test(tokens[0] ?? '') &&
    !/[\\/]/u.test(tokens[0] ?? '')
  ) {
    return commandSplit.remainingCommand
      ? commandProgramNameInternal(
          commandSplit.remainingCommand,
          depth,
          context,
          segmentsRemaining - 1,
        )
      : null
  }

  const state: CommandProgramState = {
    index: 0,
    wrapper: null,
    executionContext: context,
    sawAssignment: false,
    sawRedirection: false,
  }

  while (state.index < tokens.length) {
    const result = parseProgramToken(state, tokens, commandSplit, depth, segmentsRemaining)
    if (result !== undefined) return result
  }

  if (
    (state.sawAssignment || state.sawRedirection) &&
    state.wrapper === null &&
    commandSplit.remainingCommand
  ) {
    return commandProgramNameInternal(
      commandSplit.remainingCommand,
      depth,
      state.executionContext,
      segmentsRemaining - 1,
    )
  }
  return null
}

function parseProgramToken(
  state: CommandProgramState,
  tokens: readonly string[],
  commandSplit: ShellCommandSplit,
  depth: number,
  segmentsRemaining: number,
): string | null | undefined {
  const token = tokens[state.index]
  if (!token) return null
  const indexAfterRedirection = indexAfterShellRedirection(tokens, state.index)
  if (indexAfterRedirection !== null) {
    if (indexAfterRedirection > tokens.length) return null
    state.sawRedirection = true
    state.index = indexAfterRedirection
    return undefined
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(token)) {
    state.sawAssignment = true
    state.index += 1
    return undefined
  }
  if (state.executionContext === 'shell' && token === ':') {
    return commandSplit.remainingCommand
      ? commandProgramNameInternal(
          commandSplit.remainingCommand,
          depth,
          state.executionContext,
          segmentsRemaining - 1,
        )
      : null
  }
  if (
    NON_PROGRAM_PREFIX_CHARACTERS.includes(token[0] ?? '') &&
    !(token.startsWith('$') && token.includes('/'))
  ) {
    return state.executionContext === 'shell' &&
      token.startsWith('[') &&
      commandSplit.remainingCommand
      ? commandProgramNameInternal(
          commandSplit.remainingCommand,
          depth,
          state.executionContext,
          segmentsRemaining - 1,
        )
      : null
  }
  const tokenProgram = token.split(/[\\/]/).at(-1)
  const isUnqualifiedToken = token === tokenProgram
  if (tokenProgram === 'env' || tokenProgram === 'sudo') {
    state.wrapper = tokenProgram
    state.executionContext = 'exec'
    state.index += 1
    return undefined
  }
  if (state.wrapper !== null && token === '--') {
    state.wrapper = null
    state.index += 1
    return undefined
  }
  if (state.wrapper !== null && token.startsWith('-')) {
    return parseWrapperOption(state, tokens, depth, segmentsRemaining)
  }
  if (tokenProgram && SHELL_PROGRAMS.has(tokenProgram.replace(/\.exe$/i, '').toLowerCase())) {
    const scriptIndex = shellCommandArgumentIndex(tokens, state.index + 1)
    if (scriptIndex !== null) {
      const script = tokens[scriptIndex]
      return script
        ? commandProgramNameInternal(script, depth + 1, 'shell', segmentsRemaining)
        : null
    }
  }
  const lowerTokenProgram = tokenProgram?.toLowerCase()
  if (lowerTokenProgram && WINDOWS_SHELL_PROGRAMS.has(lowerTokenProgram)) {
    const payload = windowsShellPayloadProgramName(
      lowerTokenProgram,
      tokens,
      state.index + 1,
      depth,
      commandSplit.remainingCommand,
      commandSplit.separator,
      segmentsRemaining,
    )
    if (payload.matched) return payload.program
  }
  if (lowerTokenProgram === 'start-process') {
    const startedProgram = startProcessProgramName(tokens, state.index + 1)
    if (startedProgram !== null) return startedProgram
  }
  if (
    state.executionContext === 'shell' &&
    isUnqualifiedToken &&
    tokenProgram &&
    SHELL_PRECOMMAND_MODIFIERS.has(tokenProgram)
  ) {
    state.index += 1
    if (tokenProgram === 'time' && tokens[state.index] === '-p') state.index += 1
    if (tokens[state.index]?.startsWith('-')) return null
    return undefined
  }
  if (isUnqualifiedToken && tokenProgram) {
    const wrappedProgram = transparentWrapperProgram(
      tokenProgram,
      tokens,
      state.index,
      depth,
      segmentsRemaining,
    )
    if (wrappedProgram !== null) return wrappedProgram
  }
  if (isUnqualifiedToken && tokenProgram && SHELL_COMMAND_WRAPPERS.has(tokenProgram)) {
    return wrappedShellCommandProgramName(
      tokenProgram,
      tokens,
      state.index + 1,
      depth,
      commandSplit.remainingCommand,
      segmentsRemaining,
    )
  }
  if (
    (state.executionContext === 'shell' ||
      (state.wrapper === 'sudo' && tokenProgram && SKIPPABLE_SUDO_PROBES.has(tokenProgram))) &&
    isUnqualifiedToken &&
    tokenProgram &&
    NON_DESCRIPTIVE_SHELL_PROGRAMS.has(tokenProgram) &&
    (!TERMINAL_SHELL_PROGRAMS.has(tokenProgram) ||
      (tokenProgram === 'false' && commandSplit.separator !== '&&')) &&
    commandSplit.remainingCommand
  ) {
    return commandProgramNameInternal(
      commandSplit.remainingCommand,
      depth,
      'shell',
      segmentsRemaining - 1,
    )
  }
  if (
    state.executionContext === 'shell' &&
    isUnqualifiedToken &&
    lowerTokenProgram &&
    POWERSHELL_SETUP_PROGRAMS.has(lowerTokenProgram) &&
    commandSplit.remainingCommand
  ) {
    return commandProgramNameInternal(
      commandSplit.remainingCommand,
      depth,
      'shell',
      segmentsRemaining - 1,
    )
  }
  if (
    !tokenProgram ||
    (isUnqualifiedToken && NON_DESCRIPTIVE_SHELL_PROGRAMS.has(tokenProgram)) ||
    NON_PROGRAM_PREFIX_CHARACTERS.includes(tokenProgram[0] ?? '') ||
    NON_PROGRAM_SUFFIX_CHARACTERS.includes(tokenProgram.at(-1) ?? '') ||
    tokenProgram.endsWith('()') ||
    /^[A-Za-z_][A-Za-z0-9_]*\(\)\{$/u.test(tokenProgram)
  ) {
    return null
  }
  return tokenProgram || null
}

function commandProgramNameInternal(
  command: string,
  depth: number,
  context: CommandProgramContext,
  segmentsRemaining = MAX_COMMAND_SEGMENTS,
): string | null {
  if (segmentsRemaining <= 0) return null
  const calledProgram = powerShellCallOperatorProgramName(command)
  if (calledProgram !== undefined) return calledProgram
  return (
    parseCommandProgramName(command, depth, context, segmentsRemaining) ??
    (context === 'shell' ? literalCommandAliasProgramName(command) : null)
  )
}

export function commandProgramName(command: string, depth = 0): string | null {
  return commandProgramNameInternal(command, depth, 'shell', MAX_COMMAND_SEGMENTS)
}

export function commandIsSingleSearch(command: string, depth = 0): boolean {
  if (depth >= 8) return false
  const split = splitFirstShellCommand(command)
  if (split.remainingCommand) return false
  const tokens = tokenizeShellCommand(split.firstCommand)
  if (!tokens) return false
  const shellIndex = tokens.findIndex((token) => SHELL_PROGRAMS.has(token.split('/').at(-1) ?? ''))
  if (shellIndex >= 0) {
    const scriptIndex = shellCommandArgumentIndex(tokens, shellIndex + 1)
    const script = scriptIndex === null ? null : tokens[scriptIndex]
    return script ? commandIsSingleSearch(script, depth + 1) : false
  }

  const program = commandProgramName(command)
  return program === 'rg' || program === 'grep'
}

function parseWrapperOption(
  state: CommandProgramState,
  tokens: readonly string[],
  depth: number,
  segmentsRemaining: number,
): string | null | undefined {
  const token = tokens[state.index]!
  const wrapper = state.wrapper
  if (wrapper === null) return null
  if (wrapper === 'env' && (token === '-S' || token === '--split-string')) {
    const splitCommand = tokens[state.index + 1]
    return splitCommand
      ? commandProgramNameInternal(
          splitCommand,
          depth + 1,
          state.executionContext,
          segmentsRemaining,
        )
      : null
  }
  if (wrapper === 'env' && token.startsWith('--split-string=')) {
    return commandProgramNameInternal(
      token.slice('--split-string='.length),
      depth + 1,
      state.executionContext,
      segmentsRemaining,
    )
  }
  if (COMMAND_WRAPPER_OPTIONS_WITH_VALUE[wrapper].has(token)) {
    if (tokens[state.index + 1] === undefined) return null
    state.index += 2
    return undefined
  }
  if (COMMAND_WRAPPER_FLAGS[wrapper].has(token)) {
    state.index += 1
    return undefined
  }
  const equalsIndex = token.indexOf('=')
  if (token.startsWith('--') && equalsIndex > 2) {
    if (!COMMAND_WRAPPER_OPTIONS_WITH_VALUE[wrapper].has(token.slice(0, equalsIndex))) {
      return null
    }
    state.index += 1
    return undefined
  }
  if (/^-[A-Za-z].+/.test(token) && !token.startsWith('--')) {
    const width = shortWrapperOptionWidth(wrapper, token)
    if (width === null || (width === 2 && tokens[state.index + 1] === undefined)) return null
    state.index += width
    return undefined
  }
  return null
}

function aliasCommandIndex(tokens: readonly string[]) {
  let index = tokens[0] === 'do' || tokens[0] === 'then' ? 1 : 0
  while (index < tokens.length) {
    const next = indexAfterShellRedirection(tokens, index)
    if (next !== null && next <= tokens.length) {
      index = next
      continue
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*\+?=/u.test(tokens[index] ?? '')) break
    index += 1
  }
  return index
}

function updateLiteralAliases(aliases: Map<string, string>, tokens: readonly string[]) {
  if (tokens[0] === 'unset') {
    for (const name of tokens.slice(1)) aliases.delete(name)
  }
  const start = tokens[0] === 'export' ? 1 : 0
  const assignments = tokens.slice(start).map(literalAssignmentProgram)
  if (assignments.length === 0 || !assignments.every((assignment) => assignment !== null)) return
  for (const assignment of assignments) {
    if (!assignment.program) {
      aliases.delete(assignment.name)
      continue
    }
    aliases.set(assignment.name, assignment.program)
  }
}

function shellWrapperTargetIndex(
  wrapper: string,
  tokens: readonly string[],
  start: number,
): number | null {
  if (wrapper === 'builtin') {
    if (tokens[start] === '--') return start + 1
    return tokens[start]?.startsWith('-') ? null : start
  }
  let index = start
  while (index < tokens.length) {
    const option = tokens[index]!
    if (option === '--') return index + 1
    if (!option.startsWith('-') || option === '-') return index
    if (wrapper === 'command' && option === '-p') {
      index += 1
      continue
    }
    if (wrapper === 'command') return null
    if (option === '-a' && tokens[index + 1] === undefined) return null
    if (option === '-a') {
      index += 2
      continue
    }
    if (!/^-a.+/u.test(option) && !/^-[cl]+$/u.test(option)) return null
    index += 1
  }
  return index
}

function transparentWrapperProgram(
  wrapper: string,
  tokens: readonly string[],
  index: number,
  depth: number,
  segmentsRemaining: number,
) {
  const targetIndex = transparentWrapperCommandIndex(wrapper, tokens, index)
  if (targetIndex === null) return null

  return commandProgramNameInternal(
    serializeShellTokens(tokens.slice(targetIndex)),
    depth + 1,
    'exec',
    segmentsRemaining,
  )
}

function shortWrapperOptionWidth(wrapper: CommandWrapper, token: string): number | null {
  for (const [index, option] of token.slice(1).split('').entries()) {
    const shortOption = `-${option}`
    if (COMMAND_WRAPPER_OPTIONS_WITH_VALUE[wrapper].has(shortOption))
      return index === token.length - 2 ? 2 : 1
    if (!COMMAND_WRAPPER_FLAGS[wrapper].has(shortOption)) return null
  }
  return 1
}
