import { homedir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { SettingsStore } from '../../apps/server/src/settings/store'
import { defaultSettingsFilePath } from '../../apps/server/src/settings/paths'
import {
  WallpaperLibrary,
  OMARCHY_THEMES_DIRECTORY,
} from '../../apps/server/src/themes/wallpapers/library'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    directory: { type: 'string', default: OMARCHY_THEMES_DIRECTORY },
    output: { type: 'string', default: 'docs/research/omarchy-wallpapers.json' },
  },
})
const settings = new SettingsStore({
  userFilePath: Bun.env.PLATFORM_SETTINGS_FILE ?? defaultSettingsFilePath(),
  watch: false,
})
try {
  const library = new WallpaperLibrary({
    directory: path.join(homedir(), '.platform/wallpapers'),
    settings,
  })
  const { themes: mapping, skipped } = await library.importDirectory(values.directory)
  const file = path.resolve(values.output)
  await Bun.write(
    file,
    `${JSON.stringify({ source: 'omarchy', redistribution: 'unverified', themes: mapping }, null, 2)}\n`,
  )
  process.stdout.write(
    `Imported ${new Set(Object.values(mapping).flat()).size} assets. Mapping: ${file}\n`,
  )
  for (const item of skipped) process.stdout.write(`Skipped ${item.path} (${item.code})\n`)
} finally {
  settings.close()
}
