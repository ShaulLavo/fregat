import { sshMachineSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { createSshError } from '../structured-errors'

export type SshConfigDirective = {
  kind: 'host' | 'include'
  values: readonly string[]
}

export function parseSshConfig(contents: string): SshConfigDirective[] {
  const directives: SshConfigDirective[] = []
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const match = /^\s*([^\s=]+)\s*(?:=\s*)?(.*)$/.exec(line)
    const keyword = match?.[1]?.toLowerCase()
    if (keyword !== 'host' && keyword !== 'include') continue
    const values = configArguments(match?.[2] ?? '', index + 1)
    directives.push({ kind: keyword, values })
  }
  return directives
}

export function isSelectableSshHost(value: string) {
  return v.is(sshMachineSchema.entries.target, value)
}

function configArguments(value: string, line: number) {
  const args: string[] = []
  let word = ''
  let quote: string | null = null
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!
    if (character === '\\' && index + 1 < value.length) {
      word += value[++index]
      continue
    }
    if (character === quote) {
      quote = null
      continue
    }
    if (quote) {
      word += character
      continue
    }
    if (character === '#') break
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (!/\s/.test(character)) {
      word += character
      continue
    }
    if (word) args.push(word)
    word = ''
  }
  if (quote) throw createSshError('discovery', `Unclosed quote on line ${line}.`)
  if (word) args.push(word)
  if (args.length === 0) throw createSshError('discovery', `Missing value on line ${line}.`)
  return args
}
