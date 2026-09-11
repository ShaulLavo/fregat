import type { SessionId, EnvironmentId } from '@workspace/contracts'
import type { ApplicationRouter } from '@/state/router'

export function verifyNavigationTypes(
  router: ApplicationRouter,
  sessionId: SessionId,
  environmentId: EnvironmentId,
) {
  void router.navigate({
    to: '/~{$workspace}/workbench/f/$',
    params: { workspace: '-', _splat: 'src/a.ts' },
    search: { side: 'chat', chat: { kind: 'session', sessionId } },
  })
  void router.navigate({
    to: '/@{$environmentId}/~{$workspace}/chat/t/$sessionId',
    params: { environmentId, workspace: '-', sessionId },
  })
  void router.navigate({
    to: '/~{$workspace}/chat/t/new',
    params: { workspace: '-' },
    search: { editor: { kind: 'file', path: 'src/a.ts' }, tabs: [{ kind: 'selected' }] },
  })
  // @ts-expect-error Unknown route families cannot become destinations.
  void router.navigate({ to: '/~{$workspace}/workbench/unknown', params: { workspace: '-' } })
  // @ts-expect-error File destinations require their decoded relative path.
  void router.navigate({ to: '/~{$workspace}/workbench/f/$', params: { workspace: '-' } })
  void router.navigate({
    to: '/~{$workspace}/workbench',
    params: { workspace: '-' },
    // @ts-expect-error The sidebar enum rejects unknown panel values.
    search: { side: 'unknown' },
  })
  void router.navigate({
    to: '/~{$workspace}/chat',
    params: { workspace: '-' },
    // @ts-expect-error Editor search is a decoded discriminated reference.
    search: { editor: 'f/a.ts' },
  })
  void router.navigate({
    to: '/~{$workspace}/chat/t/$sessionId',
    // @ts-expect-error Main-chat routes require a validated branded SessionId.
    params: { workspace: '-', sessionId: 'unvalidated' },
  })
  void router.navigate({
    to: '/@{$environmentId}/~{$workspace}/workbench',
    // @ts-expect-error Remote destinations require their EnvironmentId.
    params: { workspace: '-' },
  })
}
