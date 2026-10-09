import { shellQuote } from '../../../apps/server/src/utils/shell'
import { createScriptError } from '../../structured-errors'

// Later tokens win, so appending these overrides the cgroup_disable=memory the firmware prepends.
const FLAGS = ['cgroup_enable=memory', 'psi=1'] as const
const CONFLICTS = ['cgroup_disable=memory', 'psi=0']

/** Adds each missing flag to the one-line kernel command line, keeping its existing line ending. */
export function repairCmdline(text: string) {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const ending = text.slice(body.length)
  if (/[\r\n]/.test(body)) {
    throw createScriptError(`cmdline.txt must be one line; it has ${body.split(/\r?\n/).length}.`)
  }
  const tokens = body.split(' ').filter(Boolean)
  if (!tokens.some((token) => token.startsWith('root='))) {
    throw createScriptError(
      'cmdline.txt has no root= token, so it is not a boot command line this script knows.',
    )
  }
  const conflicts = tokens.filter((token) => CONFLICTS.includes(token))
  if (conflicts.length > 0) {
    throw createScriptError(`cmdline.txt sets ${conflicts.join(' ')}; resolve that by hand.`)
  }
  const added = FLAGS.filter((flag) => !tokens.includes(flag))
  return { text: [body].concat(added).join(' ') + ending, added }
}

/**
 * Shell that saves the first backup only and replaces the file with stdin through a sibling
 * temporary file, so an interrupted write leaves the old line in place.
 */
export function cmdlineWriteScript(file: string, backup: string, sudo: string) {
  const [f, b, next] = [file, backup, `${file}.next`].map(shellQuote)
  return [
    'set -eu',
    `[ -e ${b} ] || ${sudo} cp -p ${f} ${b}`,
    `${sudo} tee ${next} >/dev/null`,
    `${sudo} mv ${next} ${f}`,
    'sync',
  ].join('\n')
}
