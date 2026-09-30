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
  const ask = appWriteAsker(server)
  return {
    name: 'platform-app-save-hmr',
    apply: 'serve',
    hotUpdate: {
      order: 'pre',
      async handler({ file, read, type }) {
        if (type === 'delete') return
        const answer = await ask(file, await read())
        if (answer.warning) this.environment.logger.warn(answer.warning)
        if (!answer.appWrite) return

        return []
      },
    },
  }
}

type AppWriteAnswer = {
  readonly appWrite: boolean
  readonly warning?: string
  /** The server turned away this dev server's origin, so it refuses every file alike. */
  readonly refused?: boolean
}

/** Asks per file until the server refuses the origin; after that each change hot-updates unasked. */
export function appWriteAsker(server: AppSaveServer) {
  let refused = false
  return async (file: string, content: string): Promise<AppWriteAnswer> => {
    if (refused) return { appWrite: false }

    const answer = await askAppWrite(server, file, content)
    refused ||= answer.refused === true
    return answer
  }
}

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
    if (response.status === 401 || response.status === 403) return refusal(server, response.status)
    if (!response.ok) return unanswered(`${url.origin} answered ${response.status} for ${file}`)

    const body: unknown = await response.json()
    return { appWrite: isAppWriteAnswer(body) && body.appWrite === true }
  } catch (error) {
    return unanswered(`${url.origin} did not answer for ${file}: ${String(error)}`)
  }
}

function refusal(server: AppSaveServer, status: number): AppWriteAnswer {
  return {
    appWrite: false,
    refused: true,
    warning: `[app-save] ${server.url} answered ${status} to origin ${server.origin}; every change hot-updates as an outside edit until this dev server restarts`,
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
