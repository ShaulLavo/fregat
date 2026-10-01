import { existsSync, readFileSync, writeFileSync } from 'node:fs'

type NativeFixtureSession = { id: string; directory: string }

export function startOpenCodeHttpFixture(
  options: {
    port?: number
    sessionFile?: string
    beforeAbortResponse?: () => Promise<void>
    beforePromptResponse?: () => Promise<Response | null>
    beforeReplyResponse?: () => Promise<Response | null>
    beforeEventHeaders?: () => Promise<void>
  } = {},
) {
  const saved: NativeFixtureSession[] =
    options.sessionFile && existsSync(options.sessionFile)
      ? JSON.parse(readFileSync(options.sessionFile, 'utf8'))
      : []
  const sessions = new Map(saved.map((session) => [session.id, session]))
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const requests: { path: string; method: string; directory: string; body: any }[] = []
  const encoder = new TextEncoder()
  let count = 0
  const emit = (type: string, properties: Record<string, unknown>) => {
    const bytes = encoder.encode(`data: ${JSON.stringify({ type, properties })}\r\n\r\n`)
    for (const stream of streams) stream.enqueue(bytes)
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port ?? 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url)
      const directory = url.searchParams.get('directory') ?? ''
      const body = request.method === 'GET' ? undefined : await request.json()
      requests.push({ path: url.pathname, method: request.method, directory, body })
      if (url.pathname === '/fixture/requests') return Response.json(requests)
      if (url.pathname === '/fixture/disconnect') {
        for (const stream of streams) stream.close()
        streams.clear()
        return Response.json(true)
      }
      if (url.pathname === '/global/health')
        return Response.json({ healthy: true, version: 'fixture-v2' })
      if (url.pathname === '/provider')
        return Response.json({
          connected: ['fixture'],
          all: [{ id: 'fixture', models: { text: { name: 'Fixture text' } } }],
        })
      if (url.pathname === '/event') {
        await options.beforeEventHeaders?.()
        let controller: ReadableStreamDefaultController<Uint8Array>
        const stream = new ReadableStream<Uint8Array>({
          start(next) {
            controller = next
            streams.add(next)
            next.enqueue(encoder.encode('data: {"type":"server.connected","properties":{}}\n\n'))
          },
          cancel() {
            streams.delete(controller)
          },
        })
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (url.pathname === '/session' && request.method === 'POST') {
        const session = { id: `native-${server.port}-${++count}`, directory }
        sessions.set(session.id, session)
        if (options.sessionFile)
          writeFileSync(options.sessionFile, JSON.stringify([...sessions.values()]))
        return Response.json(session)
      }
      const id = url.pathname.split('/')[2]!
      if (url.pathname === `/session/${id}`) {
        const session = sessions.get(id)
        if (!session) return Response.json({ error: 'missing' }, { status: 404 })
        return Response.json(session)
      }
      if (url.pathname.endsWith('/prompt_async')) {
        emit('session.status', { sessionID: id, status: { type: 'busy' } })
        const response = await options.beforePromptResponse?.()
        return response ?? new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith('/abort') && options.beforeAbortResponse) {
        emit('session.status', { sessionID: id, status: { type: 'idle' } })
        await options.beforeAbortResponse()
        return Response.json(true)
      }
      if (url.pathname.endsWith('/reply') || url.pathname.endsWith('/reject')) {
        const response = await options.beforeReplyResponse?.()
        return response ?? Response.json(true)
      }
      if (
        url.pathname.endsWith('/abort') ||
        url.pathname.endsWith('/reply') ||
        url.pathname.endsWith('/reject')
      )
        return Response.json(true)
      return Response.json({ error: 'unexpected' }, { status: 400 })
    },
  })
  return {
    url: server.url.toString().replace(/\/$/, ''),
    requests,
    sessions,
    emit,
    answer: (id: string, text = 'Fixture answer') => {
      emit('message.updated', { info: { id: `assistant-${id}`, sessionID: id, role: 'assistant' } })
      emit('message.part.updated', {
        part: {
          id: `part-${id}`,
          messageID: `assistant-${id}`,
          sessionID: id,
          type: 'text',
          text: '',
        },
      })
      emit('message.part.delta', {
        sessionID: id,
        messageID: `assistant-${id}`,
        partID: `part-${id}`,
        field: 'text',
        delta: text,
      })
      emit('message.part.updated', {
        part: { id: `part-${id}`, messageID: `assistant-${id}`, sessionID: id, type: 'text', text },
      })
    },
    complete: (id: string) => emit('session.status', { sessionID: id, status: { type: 'idle' } }),
    disconnect: () => {
      for (const stream of streams) stream.close()
      streams.clear()
    },
    close: () => {
      for (const stream of streams) stream.close()
      streams.clear()
      server.stop(true)
    },
  }
}
