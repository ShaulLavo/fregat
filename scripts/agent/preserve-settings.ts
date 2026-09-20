import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'

export async function preserveAppearance(page: Page, onlyKeys?: readonly string[]) {
  const url = new URL(page.url())
  const base = url.pathname.startsWith('/platform/')
    ? `${url.origin}/platform/`
    : `http://localhost:${process.env.PORT ?? '3001'}/`
  const headers = { origin: url.origin }
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
  const operations = (onlyKeys ?? keys).map((key) => {
    const entry = Object.entries(raw).find(([name]) => name === key)
    return entry ? { kind: 'set', key, value: entry[1] } : { kind: 'reset', keys: [key] }
  })
  return async () => {
    const response = await page.request.post(`${base}settings/write`, {
      headers,
      data: { mutationId: crypto.randomUUID(), target: 'user', operations },
    })
    strictEqual(response.ok(), true, 'Restore original appearance settings')
  }
}
