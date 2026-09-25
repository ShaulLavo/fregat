import { useIsMutating } from '@tanstack/react-query'
import type { ThemeBundle } from '@workspace/contracts'

import { errorMessage } from '@/lib/error-message'
import { useBundleActions } from '@/lib/theme-library/hooks/use-bundle-actions'
import { useBundleExport } from '@/lib/theme-library/hooks/use-bundle-export'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { bundleMutationKeys } from '@/lib/theme-library/utils/keys'
import { useStudioStore } from '@/lib/theme-studio/state/studio-store'
import { toastError } from '@/lib/toast-error'
import { useSavePaletteEdits } from '@/features/theme-studio/hooks/use-save-palette-edits'
import { useStudioDraft } from '@/features/theme-studio/hooks/use-studio-draft'
import { newThemeDocument, savedDraft } from '@/features/theme-studio/utils/draft'

/** Library actions for the Themes tab. A theme they create becomes the draft, unapplied. */
export function useThemeActions() {
  const { draft, customizations } = useStudioDraft()
  const chooseTheme = useStudioStore((state) => state.chooseTheme)
  const revert = useStudioStore((state) => state.revert)
  const owner = useSettingsOwner()
  const bundles = useBundleActions()
  const pending = useIsMutating({ mutationKey: bundleMutationKeys.all }, owner) > 0
  const exportBundle = useBundleExport()
  const savePaletteEdits = useSavePaletteEdits()
  const choose = (theme: ThemeBundle) => chooseTheme(savedDraft(theme, customizations))
  const fail = (title: string) => (error: unknown) =>
    toastError(title, { description: errorMessage(error, 'Try again.') })

  async function newFromCurrent() {
    if (!draft || !(await savePaletteEdits())) return
    bundles.create.mutate(newThemeDocument(`${draft.theme.name} copy`, draft.variants), {
      onError: fail('The theme could not be created'),
      onSuccess: choose,
    })
  }

  function duplicate() {
    if (!draft) return
    const saved = savedDraft(draft.theme, customizations)
    bundles.create.mutate(newThemeDocument(`${draft.theme.name} copy`, saved.variants), {
      onError: fail('The theme could not be duplicated'),
      onSuccess: choose,
    })
  }

  function importFile(file: File) {
    bundles.importArchive.mutate(file, {
      onError: fail(`${file.name} could not be imported`),
      onSuccess: choose,
    })
  }

  function exportTheme() {
    if (draft) exportBundle(draft.theme.id).catch(fail('The theme could not be exported'))
  }

  function remove() {
    if (!draft || draft.theme.source === 'bundled') return
    bundles.remove.mutate(draft.theme.id, {
      onError: fail(`${draft.theme.name} could not be deleted`),
      onSuccess: revert,
    })
  }

  return {
    theme: draft?.theme ?? null,
    pending,
    newFromCurrent,
    duplicate,
    importFile,
    exportTheme,
    remove,
  }
}
