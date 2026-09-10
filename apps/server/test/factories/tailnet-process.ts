import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

export async function runTailnetProcess(directory: string, source: string): Promise<unknown> {
  await writeFile(path.join(directory, 'tailscale'), `#!${process.execPath}\n${source}`, {
    mode: 0o755,
  })
  const moduleUrl = new URL('../../src/machines/tailnet-hosts.ts', import.meta.url).href
  const program = `
    const { discoverTailnetHosts } = await import(${JSON.stringify(moduleUrl)});
    console.log(JSON.stringify(await discoverTailnetHosts()));
  `
  const { stdout } = await promisify(execFile)(process.execPath, ['-e', program], {
    env: { ...process.env, PATH: directory },
    timeout: 8000,
    killSignal: 'SIGKILL',
  })
  return JSON.parse(stdout)
}
