// Vitest `test.env` for server, web and TUI. Workers start with it, so the server under test
// commits as this identity too; Bun.spawn ignores process.env writes made after startup.
export const gitFixtureEnv = {
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_AUTHOR_NAME: 'Test User',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test User',
  GIT_CONFIG_NOSYSTEM: '1',
}
