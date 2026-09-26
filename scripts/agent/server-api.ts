import type { Page } from 'playwright'

/**
 * The API the page talks to, with no trailing slash, plus the origin header it must carry.
 * `preserveAppearance` and the wallpaper scenarios build a slash-terminated base of their own;
 * that is a different string, not a copy of this one.
 */
export function serverApi(page: Page) {
  const url = new URL(page.url())
  const base = url.pathname.startsWith('/platform/')
    ? `${url.origin}/platform`
    : `http://localhost:${process.env.PORT ?? '3001'}`
  return { base, headers: { origin: url.origin } }
}

export type UserSettings = Readonly<Record<string, unknown>>

/** The user layer exactly as the file holds it, read from the server under test. */
export async function userSettings(page: Page): Promise<UserSettings> {
  const { base, headers } = serverApi(page)
  const document = (await (await page.request.get(`${base}/settings`, { headers })).json()) as {
    layers: { id: string; raw: UserSettings }[]
  }
  return document.layers.find((layer) => layer.id === 'user')?.raw ?? {}
}

export function selectedThemeId(settings: UserSettings) {
  return (settings['workbench.theme'] as { id?: string } | null | undefined)?.id ?? null
}
