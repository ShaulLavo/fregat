import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import * as v from 'valibot'
import { keybindingOverridesSchema } from '../../packages/contracts/src/settings'
import type { SettingsOperation } from '../../packages/contracts/src/settings/mutations'

/** The settings API behind the page: the mesh serves it under /platform, dev on the API port. */
function settingsApi(page: Page) {
  const url = new URL(page.url())
  const base = url.pathname.startsWith('/platform/')
    ? `${url.origin}/platform/`
    : `http://localhost:${process.env.PORT ?? '3001'}/`
  return { base, headers: { origin: url.origin } }
}

type SettingOperation =
  | Extract<
      SettingsOperation,
      {
        readonly kind:
          | 'keybinding.set'
          | 'keybinding.remove'
          | 'keybinding.append'
          | 'keybinding.delete'
      }
    >
  | { readonly kind: 'set'; readonly key: string; readonly value: unknown }
  | { readonly kind: 'reset'; readonly keys: readonly string[] }
  | { readonly kind: 'machine.set'; readonly name: string; readonly machine: unknown }

export async function writeUserOperations(page: Page, operations: readonly SettingOperation[]) {
  const { base, headers } = settingsApi(page)
  const response = await page.request.post(`${base}settings/write`, {
    headers,
    data: { mutationId: crypto.randomUUID(), target: 'user', operations },
  })
  const keys = operations.flatMap(operationKeys)
  if (response.ok()) return
  strictEqual(
    response.ok(),
    true,
    `Write user settings ${keys.join(', ')}: ${response.status()} ${await response.text()}`,
  )
}

/** The value the user layer itself holds for `key`, as the settings API reports it. */
export async function readUserSetting(page: Page, key: string): Promise<unknown> {
  const { base, headers } = settingsApi(page)
  const snapshot: unknown = await (await page.request.get(`${base}settings`, { headers })).json()
  ok(snapshot && typeof snapshot === 'object' && 'layers' in snapshot)
  ok(Array.isArray(snapshot.layers))
  const user: unknown = snapshot.layers.find((layer) => layer.id === 'user')
  ok(user && typeof user === 'object' && 'raw' in user && user.raw && typeof user.raw === 'object')
  return (user.raw as Record<string, unknown>)[key]
}

/** The resolved value of one key on the server behind the page. */
export async function readSetting(page: Page, key: string): Promise<unknown> {
  const { base, headers } = settingsApi(page)
  const snapshot: unknown = await (await page.request.get(`${base}settings`, { headers })).json()
  ok(snapshot && typeof snapshot === 'object' && 'values' in snapshot)
  const values = snapshot.values
  ok(values && typeof values === 'object')

  return (values as Record<string, unknown>)[key]
}

export async function writeUserSetting(page: Page, key: string, value: unknown) {
  await writeUserOperations(page, [{ kind: 'set', key, value }])
}

export async function preserveAppearance(page: Page, onlyKeys?: readonly string[]) {
  const { base, headers } = settingsApi(page)
  const before: unknown = await (await page.request.get(`${base}settings`, { headers })).json()
  ok(before && typeof before === 'object' && 'layers' in before && Array.isArray(before.layers))
  const user: unknown = before.layers.find((layer) => layer.id === 'user')
  ok(user && typeof user === 'object' && 'raw' in user)
  const raw = user.raw
  ok(raw && typeof raw === 'object')
  const keys = [
    'workbench.wallpaper',
    'workbench.colorTheme',
    'workbench.theme',
    'workbench.theme.customizations',
    'workbench.palette',
    'editor.codeTheme.light',
    'editor.codeTheme.dark',
    'workbench.surface.opacity',
    'workbench.surface.contentOpacity',
    'workbench.surface.blur',
    'workbench.surface.saturation',
  ]
  const operations = (onlyKeys ?? keys).flatMap((key): readonly SettingOperation[] => {
    const entry = Object.entries(raw).find(([name]) => name === key)
    if (key === 'keybindings.overrides' && entry)
      return Array.of<SettingOperation>({ kind: 'reset', keys: [key] }).concat(
        v
          .parse(keybindingOverridesSchema, entry[1])
          .map((binding) => ({ kind: 'keybinding.append' as const, entry: binding })),
      )
    return [entry ? { kind: 'set', key, value: entry[1] } : { kind: 'reset', keys: [key] }]
  })
  return async () => {
    for (const operation of operations) await writeUserOperations(page, [operation])
  }
}

function operationKeys(operation: SettingOperation): readonly string[] {
  if (operation.kind === 'set') return [operation.key]
  if (operation.kind === 'reset') return operation.keys
  if (
    operation.kind === 'keybinding.set' ||
    operation.kind === 'keybinding.remove' ||
    operation.kind === 'keybinding.append' ||
    operation.kind === 'keybinding.delete'
  )
    return ['keybindings.overrides']
  return [`environments.machines.${operation.name}`]
}
