/*
 * The site's Worker: serves the built files and writes the visitor's scene into each page, so the first paint already
 * has the scene's colours, and the landing page's hero its first frame. The landing page draws a new scene each
 * visit; other pages keep the visitor's scene through a session cookie. ?scene=name pins one anywhere.
 */

interface Fetcher {
  fetch(input: Request | URL | string): Promise<Response>
}

interface Element {
  setAttribute(name: string, value: string): void
  setInnerContent(content: string, options?: { html: boolean }): void
}

declare class HTMLRewriter {
  on(selector: string, handlers: { element(element: Element): void }): HTMLRewriter
  transform(response: Response): Response
}

interface Env {
  readonly ASSETS: Fetcher
}

interface Scene {
  readonly name: string
  readonly theme: Readonly<Record<string, string>>
}

const COOKIE = 'scene'

let scenes: Promise<Scene[]> | undefined

function sceneList(env: Env, origin: URL): Promise<Scene[]> {
  scenes ??= env.ASSETS.fetch(new URL('/scenes/index.json', origin)).then(
    (response) => response.json() as Promise<Scene[]>,
  )
  return scenes
}

function cookieScene(request: Request): string | null {
  const header = request.headers.get('cookie') ?? ''
  return /(?:^|;\s*)scene=([a-z-]+)/.exec(header)?.[1] ?? null
}

function pick(list: readonly Scene[], url: URL, request: Request): Scene {
  const landing = url.pathname === '/'
  const asked = url.searchParams.get('scene') ?? (landing ? null : cookieScene(request))
  return (
    list.find((scene) => scene.name === asked) ?? list[Math.floor(Math.random() * list.length)]!
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request)
    if (!(response.headers.get('content-type') ?? '').startsWith('text/html')) return response

    const url = new URL(request.url)
    const scene = pick(await sceneList(env, url), url, request)
    const style = Object.entries(scene.theme)
      .map(([name, value]) => `--${name}:${value}`)
      .join(';')
    const frame =
      url.pathname === '/'
        ? await env.ASSETS.fetch(new URL(`/scenes/${scene.name}.txt`, url)).then((r) => r.text())
        : ''

    const page = new HTMLRewriter()
      .on('html', {
        element(element) {
          element.setAttribute('data-scene', scene.name)
          element.setAttribute('style', style)
        },
      })
      .on('#scene-frame', {
        element(element) {
          // Raw: the frame's colour codes include < and >, and it never contains the / that could close the tag.
          element.setInnerContent(frame, { html: true })
        },
      })
      .transform(response)
    const result = new Response(page.body, page)
    // Each response carries its own scene, so no shared cache may keep one.
    result.headers.set('cache-control', 'private, no-cache')
    result.headers.append('set-cookie', `${COOKIE}=${scene.name}; Path=/; SameSite=Lax; Secure`)
    return result
  },
}
