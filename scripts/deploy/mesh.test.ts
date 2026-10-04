import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const source = readFileSync(path.join(import.meta.dirname, '../install-release.ts'), 'utf8')

const reportingTemplates = [
  {
    step: 'restart',
    pattern: /console\.log\((`\\n\[install-release\] \$\{target\.name\} is live at [^`]+`)\)/,
  },
  {
    step: 'rollback',
    pattern:
      /console\.log\((`\\n\[install-release\] rolled back to \$\{target\.name\} at [^`]+`)\)/,
  },
  { step: 'check', pattern: /log\('live', (`checking [^`]+`)\)/ },
]

test.each(reportingTemplates)(
  '$step reports the checked release target when configuration changed',
  ({ pattern }) => {
    const expression = source.match(pattern)?.[1]
    expect(expression).toBeDefined()
    // Evaluate only the CLI's output expression; deployment and service control stay untouched.
    const render = new Function('target', 'meshUrl', `return ${expression}`)
    const recorded = 'https://previous.example/previous/'
    const configured = 'https://configured.example/current/'
    const target = { name: 'previous-release', meshUrl: recorded }
    expect(render(target, recorded)).toContain(recorded)
    const message = render(target, configured)
    expect(message).toContain(recorded)
    expect(message).not.toContain(configured)
  },
)
