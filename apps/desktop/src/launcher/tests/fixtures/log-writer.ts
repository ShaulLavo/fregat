import {
  initializeObservabilityRuntime,
  flushObservability,
  recordObservabilityInfo,
} from '@workspace/observability'

const [directory, source] = Bun.argv.slice(2)
initializeObservabilityRuntime({
  env: {
    NODE_ENV: 'production',
    OBSERVABILITY_DIR: directory,
    OBSERVABILITY_CONSOLE: 'false',
    OBSERVABILITY_MAX_SIZE_BYTES: '1',
    OBSERVABILITY_MAX_FILES: source === 'desktop' ? '2' : '1',
  },
  source: source!,
  filePrefix: source === 'desktop' ? 'desktop-' : undefined,
})

async function write(action: string) {
  recordObservabilityInfo(action, { source, area: source })
  await flushObservability()
}

if (source === 'desktop') {
  await write('desktop.before_server_rotation')
  console.log('ready')
  await new Response(Bun.stdin).text()
  await write('desktop.after_server_rotation')
} else {
  for (let index = 0; index < 3; index++) await write(`server.rotation.${index}`)
}
