import { useSettingsReloadOwner } from '@/features/settings/hooks/use-reload-owner'
import { useLayoutEffect, useRef } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { captureSettingsView, settingsScrollTop } from '@/features/settings/state/reload'
import { useSettingsScope } from '@/features/settings/state/scope-store'
import { useSettingsView } from '@/features/settings/state/view-store'
import { useSettingsCategory } from '@/features/settings/state/category-store'
import { useSettingsSearch } from '@/features/settings/state/search-store'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'

export function useReloadView(owner: QueryClient, ready: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const scope = useSettingsScope()
  const view = useSettingsView()
  const search = useSettingsSearch()
  const category = useSettingsCategory()
  const generation = useSettingsReloadOwner(owner)?.generation
  useLayoutEffect(() => {
    if (!ready) return
    const node = ref.current
    let scrollTop = settingsScrollTop(owner, scope, view, search, category)
    if (node) node.scrollTop = scrollTop
    const rememberScroll = () => {
      scrollTop = node?.scrollTop ?? scrollTop
    }
    node?.addEventListener('scroll', rememberScroll)
    const capture = () =>
      captureSettingsView(
        owner,
        {
          scope,
          view,
          search,
          category,
          scrollTop,
        },
        generation,
      )
    const remove = addLifecycleFlush(capture)
    return () => {
      capture()
      node?.removeEventListener('scroll', rememberScroll)
      remove()
    }
  }, [owner, generation, ready, scope, view, search, category])
  return ref
}
