import * as v from 'valibot'
import { syncCredentials } from './credentials'
import { createGateway } from './gateway'

const portSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535))
const configSchema = v.object({
  binary: v.string(),
  proxyConfig: v.string(),
  proxyPort: portSchema,
  gatewayPort: portSchema,
  apiKey: v.pipe(v.string(), v.nonEmpty()),
  authSources: v.array(v.string()),
  authDir: v.string(),
})
try {
  await run()
} catch (error) {
  reportFailure('startup', error)
  process.exit(1)
}

function reportFailure(operation: string, error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      source: 'be',
      area: 'claude-gpt',
      operation,
      errorType: error instanceof Error ? error.name : typeof error,
      fix: 'Check the runtime configuration, Codex login and mesh route.',
    })}\n`,
  )
}

async function run() {
  const config = v.parse(configSchema, await Bun.file(Bun.argv[2] ?? '').json())
  await syncCredentials(config.authSources, config.authDir)
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: config.gatewayPort,
    idleTimeout: 0,
    fetch: createGateway({
      anthropicUrl: 'https://api.anthropic.com',
      proxyUrl: `http://127.0.0.1:${config.proxyPort}`,
      apiKey: config.apiKey,
      syncCredentials: () => syncCredentials(config.authSources, config.authDir),
    }),
    error(error) {
      reportFailure('request', error)
      return Response.json(
        {
          type: 'error',
          error: {
            type: 'api_error',
            message:
              'The gateway could not reach the model provider. Check the proxy login and mesh route.',
          },
        },
        { status: 502 },
      )
    },
  })
  const proxy = Bun.spawn([config.binary, '-config', config.proxyConfig], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  function stop() {
    server.stop(true)
    proxy.kill('SIGTERM')
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  const exitCode = await proxy.exited
  server.stop(true)
  process.exit(exitCode)
}
