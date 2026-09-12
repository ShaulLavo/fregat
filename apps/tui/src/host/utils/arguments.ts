import { parseArgs } from 'node:util'

import { createTuiError } from '@/host/utils/structured-errors'

export function readArguments(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      origin: { type: 'string', default: env.VITE_SERVER_URL ?? 'http://127.0.0.1:3001' },
      'headless-frame': { type: 'string' },
      width: { type: 'string', default: '100' },
      height: { type: 'string', default: '30' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  return {
    origin: serverOrigin(values.origin),
    framePath: values['headless-frame'],
    width: dimension(values.width, 'width', 40, 400),
    height: dimension(values.height, 'height', 12, 200),
    help: values.help,
    noColor: Boolean(env.NO_COLOR),
  }
}

function serverOrigin(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidOrigin()
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalidOrigin()
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw invalidOrigin()
  }
  return url.origin
}

function invalidOrigin() {
  return createTuiError(
    'Invalid server origin.',
    'Use an HTTP or HTTPS origin without credentials, a path, a query, or a fragment.',
  )
}

function dimension(value: string, name: string, min: number, max: number) {
  const result = Number(value)
  if (Number.isInteger(result) && result >= min && result <= max) return result

  throw createTuiError(`Invalid ${name}: ${value}`, `Choose ${name} between ${min} and ${max}.`)
}

export const usage = `Platform TUI

Usage: bun run dev:tui [options]

  --origin <url>            Attach to an existing Platform server
  --headless-frame <path>   Write one rendered frame and exit
  --width <columns>        Frame width, default 100
  --height <rows>          Frame height, default 30
  --help                  Show this help

Tab changes focus. Arrow keys select a setting. Ctrl+R refreshes. Ctrl+C quits.
`
