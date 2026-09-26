import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

type Fetcher = (request: Request) => Response | Promise<Response>

export type AppSaveServer = {
  /** The API server whose saves this dev server should not hot-update. */
  readonly url: string
  /** An origin the server allows; the dev server asks as the page it serves. */
  readonly origin: string
  readonly fetcher?: Fetcher
}

/** A file the app itself saved is already what the editor shows, so it skips the hot update. */
export function appSaveHmrPlugin(server: AppSaveServer): Plugin {
  return {
    name: 'platform-app-save-hmr',
    apply: 'serve',
    hotUpdate: {
      order: 'pre',
      async handler({ file, read, type }) {
        if (type === 'delete') return
        const answer = await askAppWrite(server, file, await read())
        if (answer.warning) this.environment.logger.warn(answer.warning)
        if (!answer.appWrite) return

        return []
      },
    },
  }
}

type AppWriteAnswer = { readonly appWrite: boolean; readonly warning?: string }

/** Whether the server's last app write to `file` produced exactly `content`. */
export async function askAppWrite(
  server: AppSaveServer,
  file: string,
  content: string,
): Promise<AppWriteAnswer> {
  const url = new URL('fs/app-write', server.url.endsWith('/') ? server.url : `${server.url}/`)
  url.searchParams.set('path', file)
  url.searchParams.set('version', textVersion(content))
  const request = new Request(url, { headers: { origin: server.origin } })
  try {
    const response = await (server.fetcher ?? fetch)(request)
    if (!response.ok) return unanswered(`${url.origin} answered ${response.status} for ${file}`)

    const body: unknown = await response.json()
    return { appWrite: isAppWriteAnswer(body) && body.appWrite === true }
  } catch (error) {
    return unanswered(`${url.origin} did not answer for ${file}: ${String(error)}`)
  }
}

function unanswered(reason: string): AppWriteAnswer {
  return { appWrite: false, warning: `[app-save] ${reason}; hot-updating it as an outside edit` }
}

// Same digest as the server's `textFileVersion`: the server writes the text as UTF-8.
function textVersion(content: string) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function isAppWriteAnswer(value: unknown): value is { appWrite: boolean } {
  return typeof value === 'object' && value !== null && 'appWrite' in value
}
