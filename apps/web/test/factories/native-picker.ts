import { existsSync } from 'node:fs'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { nativePickerRequestSchema } from '@workspace/contracts'
import * as v from 'valibot'
import type { TestServer } from '../server'
import { TEST_ENVIRONMENT_ID } from './chat'
import { serverCapabilities } from './server-capabilities'

export async function installNativePickerHelper(
  server: TestServer,
  paths: readonly string[] | null,
) {
  const helper = path.join(server.root, 'native-picker-helper')
  const calls = path.join(server.root, 'native-picker-calls.jsonl')
  const result =
    paths === null
      ? 'process.exit(7)'
      : `console.log(${JSON.stringify(JSON.stringify({ event: 'picked', paths }))})`
  await writeFile(
    helper,
    `#!${process.execPath}\nimport { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(calls)}, process.argv[3] + '\\n')\n${result}\n`,
  )
  await chmod(helper, 0o700)
  const filesystemRoot = path.parse(server.root).root
  await server.restart({
    systemRoot: filesystemRoot,
    workspaceRoot: filesystemRoot,
    system: {
      address: server.origin,
      stateHome: server.root,
      machineId: () => serverCapabilities(TEST_ENVIRONMENT_ID).machineId,
      nativePickerHelper: helper,
      desktop: () => true,
      peer: () => '127.0.0.1',
    },
  })
  return async () => {
    if (!existsSync(calls)) return []
    const recorded = await readFile(calls, 'utf8')
    return recorded
      .trim()
      .split('\n')
      .map((line) => v.parse(nativePickerRequestSchema, JSON.parse(line)))
  }
}
