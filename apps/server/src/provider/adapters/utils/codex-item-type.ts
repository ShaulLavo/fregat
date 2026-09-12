export function canonicalItemType(value: string | null) {
  switch (value) {
    case 'agentMessage':
      return 'assistant_message'
    case 'commandExecution':
      return 'command_execution'
    case 'fileChange':
      return 'file_change'
    case 'mcpToolCall':
      return 'mcp_tool_call'
    case 'dynamicToolCall':
      return 'dynamic_tool_call'
    case 'webSearch':
      return 'web_search'
    case 'imageView':
      return 'image_view'
    case 'reasoning':
      return 'reasoning'
    case 'plan':
      return 'plan'
    default:
      return 'unknown'
  }
}
