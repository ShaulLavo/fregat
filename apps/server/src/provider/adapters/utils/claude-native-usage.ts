export function nativeClaudeUsageTransport(env: NodeJS.ProcessEnv): boolean {
  const externalAuth = [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  ].some((name) => Boolean(env[name]?.trim()))
  if (externalAuth) return false
  return ![
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS',
    'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
    'CLAUDE_CODE_USE_MANTLE',
    'CLAUDE_CODE_USE_GATEWAY',
  ].some((name) => ['1', 'true', 'yes', 'on'].includes(env[name]?.trim().toLowerCase() ?? ''))
}
