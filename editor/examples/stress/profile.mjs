import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export function profileSourceMaps() {
  return {
    name: 'editor-profile-source-maps',
    enforce: 'pre',
    async load(id) {
      if (!/\/packages\/[^/]+\/dist\/.*\.js$/.test(id)) return null
      const code = await readFile(id, 'utf8')
      if (!code.includes('//# sourceMappingURL=')) return null
      const map = JSON.parse(await readFile(`${id}.map`, 'utf8'))
      return { code, map }
    },
  }
}

export async function profileScenario({ cdp, directory, identity, run }) {
  if (!directory || identity.repetition < 0) return run()
  const name = `${identity.fixture}-${identity.scenario}-${identity.state}-${identity.repetition}`
  await mkdir(directory, { recursive: true })
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
  await cdp.send('Profiler.start')
  try {
    return await run()
  } finally {
    const { profile } = await cdp.send('Profiler.stop')
    await cdp.send('Profiler.disable')
    await writeFile(resolve(directory, `${name}.cpuprofile`), JSON.stringify(profile) + '\n')
  }
}
