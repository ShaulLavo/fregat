#!/usr/bin/env node
const readline = require('node:readline')
const fs = require('node:fs')

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.type !== 'control_request') return
  const request = message.request
  if (request.subtype === 'mcp_set_servers') {
    fs.writeFileSync(process.env.FAKE_CLAUDE_IPC_CAPTURE, JSON.stringify(request.servers))
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
