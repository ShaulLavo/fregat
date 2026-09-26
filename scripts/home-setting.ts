import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'
import {
  SETTINGS_REGISTRY,
  type SettingId,
  type SettingValue,
} from '../packages/contracts/src/settings/keys'
import { parseSettingsDocument } from '../apps/server/src/settings/json-document'

/** A setting as a state home's settings file holds it; missing or invalid is the registry default. */
export function readHomeSetting<K extends SettingId>(home: string, id: K): SettingValue<K> {
  const descriptor = SETTINGS_REGISTRY[id]
  const file = path.join(home, 'settings.json')
  if (!existsSync(file)) return descriptor.default as SettingValue<K>

  const { values } = parseSettingsDocument(readFileSync(file, 'utf8'))
  const parsed = v.safeParse(descriptor.schema, values[id])
  return (parsed.success ? parsed.output : descriptor.default) as SettingValue<K>
}
