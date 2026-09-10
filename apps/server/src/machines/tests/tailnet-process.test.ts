import { expect } from 'vitest'
import { test } from '../../../test/factories/ssh'
import { runTailnetProcess } from '../../../test/factories/tailnet-process'

test('runs the status command with fixed arguments through the real process boundary', async ({
  remoteRoot,
}) => {
  const result = await runTailnetProcess(
    remoteRoot,
    'console.log(JSON.stringify({BackendState:process.argv.slice(2).join(" ") === "status --json" ? "Running" : "Stopped"}));',
  )
  expect(result).toEqual({ status: 'available', hosts: [] })
})

test('stops a stalled Tailscale command before it returns an available status', async ({
  remoteRoot,
}) => {
  const result = await runTailnetProcess(
    remoteRoot,
    'await Bun.sleep(5000); console.log(JSON.stringify({BackendState:"Running"}));',
  )
  expect(result).toEqual({ status: 'unavailable', hosts: [], reason: 'failed' })
})

test('caps Tailscale output even when the oversized status would otherwise be valid', async ({
  remoteRoot,
}) => {
  const result = await runTailnetProcess(
    remoteRoot,
    'console.log(JSON.stringify({BackendState:"Running",Noise:"x".repeat(3*1024*1024)}));',
  )
  expect(result).toEqual({ status: 'unavailable', hosts: [], reason: 'failed' })
})
