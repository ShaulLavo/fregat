#!/usr/bin/env node
import * as readline from 'node:readline'
import * as fs from 'node:fs'

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message: {
    type: string
    request_id: string
    request: { subtype: string; servers: Record<string, unknown> }
  } = JSON.parse(line)
  if (message.type !== 'control_request') return
  const request = message.request
  if (request.subtype === 'mcp_set_servers') {
    fs.writeFileSync(process.env.FAKE_CLAUDE_IPC_CAPTURE!, JSON.stringify(request.servers))
  }
  const response =
    request.subtype === 'mcp_set_servers'
      ? { added: Object.keys(request.servers), removed: [], errors: {} }
      : { commands: [], models: [], agents: [] }
  process.stdout.write(
    JSON.stringify({
      type: 'control_response',
      response: { subtype: 'success', request_id: message.request_id, response },
    }) + '\n',
  )
})
