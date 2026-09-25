import { expect, test } from '../../../test/fixtures'
import { bindFixWithAgent, fixWithAgent } from '@/lib/fix-with-agent'

test('hands the report to the bound chat opener, titled by the surface that showed it', async () => {
  const prompts: string[] = []
  const unbind = bindFixWithAgent(async (prompt) => {
    prompts.push(prompt)
    return true
  })

  await expect(
    fixWithAgent({
      message: 'The server uses an incompatible protocol version.',
      title: 'Connect machine',
    }),
  ).resolves.toBe('chat')
  unbind()

  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('title: Connect machine')
  expect(prompts[0]).toContain('message: The server uses an incompatible protocol version.')
  expect(prompts[0]).toContain('logs: bun run logs --since')
})

test('an unbind from a replaced opener leaves the newer one bound', async () => {
  const first = bindFixWithAgent(async () => true)
  let reached = false
  const second = bindFixWithAgent(async () => {
    reached = true
    return true
  })
  first()

  await fixWithAgent({ message: 'boom' })
  second()
  expect(reached).toBe(true)
})
