import { mkdir, writeFile } from 'node:fs/promises'
import { DEFAULT_PROVIDER_INSTANCE_ID } from '@workspace/contracts'
import { test, expect } from '../../../test/fixtures'
import { openTestChat } from '../../../test/factories/chat'
import { readCompletions } from '@/agent-stage/state/completions'

test('completion reads actual checkout files and provider catalog, omitting disabled skills', async ({
  server,
}) => {
  const { session } = await openTestChat(server)
  try {
    await writeFile(`${server.root}/alpha.txt`, 'content')
    await mkdir(`${server.root}/src`)
    await writeFile(`${server.root}/src/other.ts`, 'export {}')
    const base = {
      session,
      cwd: server.root,
      selection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'gpt-5.5' },
      signal: session.signal,
    }
    const files = await readCompletions({ ...base, text: 'Read @alp' })
    expect(files.map((item) => item.text)).toEqual(['Read @alpha.txt '])
    const nested = await readCompletions({ ...base, text: '@src/ot' })
    expect(nested.map((item) => item.text)).toEqual(['@src/other.ts '])
    const commands = await readCompletions({ ...base, text: '/rev' })
    expect(commands.map((item) => item.text)).toContain('/review ')
    const skills = await readCompletions({ ...base, text: '$' })
    expect(skills.map((item) => item.text)).toContain('$pdf ')
    expect(skills.map((item) => item.text)).not.toContain('$pptx ')
  } finally {
    session.dispose()
  }
})
