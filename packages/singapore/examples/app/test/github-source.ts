import type { Page } from '@playwright/test'

export async function mockGitHubSourceFiles(
  page: Page,
  files: readonly { readonly path: string; readonly text: string }[],
): Promise<void> {
  await page.route('https://api.github.com/repos/ShaulLavo/singapore/commits/main', (route) =>
    route.fulfill({
      json: {
        sha: 'mock-commit-sha',
        commit: { tree: { sha: 'tree-sha' } },
      },
    }),
  )
  await page.route(
    'https://api.github.com/repos/ShaulLavo/singapore/git/trees/tree-sha?recursive=1',
    (route) =>
      route.fulfill({
        json: {
          sha: 'tree-sha',
          truncated: false,
          tree: files.map((file, index) => ({
            path: file.path,
            type: 'blob',
            sha: `file-sha-${index}`,
            size: file.text.length,
          })),
        },
      }),
  )
  for (const file of files) {
    await page.route(
      `https://raw.githubusercontent.com/ShaulLavo/singapore/mock-commit-sha/${file.path}`,
      (route) =>
        route.fulfill({
          body: file.text,
          contentType: 'text/plain',
        }),
    )
  }
}
