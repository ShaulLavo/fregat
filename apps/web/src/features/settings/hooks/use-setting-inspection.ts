import { resolveThemeSettings, jsonEqual } from '@workspace/contracts'
import { systemColorMode } from '@/features/settings/state/system-color-mode'
import {
  descriptorFor,
  inspectSetting,
  layerAllowsScope,
  SETTINGS_LAYER_ORDER,
  settingRowIds,
  type SettingId,
  type SettingInspection as SettingInspectionResult,
  type SettingScope,
  type SettingsLayerId,
  type SettingsWriteTarget,
} from '@workspace/contracts'

import type { SettingsProjection } from '@/features/settings/hooks/use-settings-projection'

export type SettingInspection = {
  /**
   * The layer being edited sets this key.
   *
   * About the layer, not about the resolved document: the marker sits next to a
   * Reset that removes the key from *this* file, so anything else lights it up
   * for a scope where reset has nothing to remove.
   */
  readonly isModified: boolean
  /** Set in a layer other than the one being edited — the page has to say so. */
  readonly alsoModifiedIn: readonly string[]
  /**
   * A layer above this one already decides the value, so a write here changes
   * the file and nothing else.
   *
   * Without it the control appears to do nothing: the user edits, the row
   * re-renders from the resolved document, and the number they just typed is
   * gone with no error to explain it.
   */
  readonly overriddenBy: SettingsLayerId | null
  /** Non-null when this key cannot be written to the selected scope, with the reason. */
  readonly disabledReason: string | null
}

/**
 * What the page needs to render one row honestly: whether it differs from stock,
 * whether some *other* layer also sets it, and whether this scope may set it at
 * all.
 *
 * Computed on the client from the snapshot's per-layer `raw`, which is why the
 * snapshot carries unfiltered layers — a value dropped by scope is still
 * reported, so the page can say "set here, not applied" rather than showing
 * nothing and looking like the file was ignored.
 */
export function settingInspection(
  id: SettingId,
  snapshot: SettingsProjection,
  scope: SettingsWriteTarget,
): SettingInspection {
  const descriptor = descriptorFor(id)
  // Across every key the row writes, not just its own: the row is what carries
  // the marker and the Reset, so a row whose ordering is set and whose hiding is
  // not would otherwise claim to be untouched and reset to nothing.
  const inspections = settingRowIds(id).map((key) => inspectSetting(key, snapshot.layers, snapshot))
  const setLayers = new Set(
    inspections.flatMap((inspection) => inspection.layers.map((layer) => layer.layer)),
  )

  const defaults = resolveThemeSettings(
    { ...snapshot.values, 'workbench.theme.customizations': {} },
    systemColorMode(),
    snapshot.layers,
  )
  const themeModified =
    scope === 'user' &&
    Boolean(snapshot.values['workbench.theme']) &&
    !jsonEqual(snapshot.values[id], defaults[id])

  return {
    // Ordered by the layer table rather than by which key happened to be read
    // first, so the sentence the row prints is stable across renders.
    alsoModifiedIn: SETTINGS_LAYER_ORDER.filter((layer) => layer !== scope && setLayers.has(layer)),
    disabledReason: writeBlockedReason(descriptor.scope, scope),
    isModified: setLayers.has(scope) || themeModified,
    overriddenBy: overridingLayer(effectiveLayerAbove(inspections), scope),
  }
}

/**
 * The winning layer of whichever key the row loses hardest on.
 *
 * A row is overridden if *any* of its keys is: the warning is about the edit
 * failing to take effect, and a row where only the ordering is pinned elsewhere
 * still misleads if it says nothing.
 */
function effectiveLayerAbove(
  inspections: readonly SettingInspectionResult[],
): SettingInspectionResult['effectiveLayer'] {
  const rank = (layer: SettingsLayerId) => SETTINGS_LAYER_ORDER.indexOf(layer)
  const above = inspections
    .map((inspection) => inspection.effectiveLayer)
    .filter((layer) => layer !== 'default')
    .sort((left, right) => rank(right) - rank(left))

  return above[0] ?? 'default'
}

/** The winning layer, when it sits above the one being edited. */
function overridingLayer(
  effectiveLayer: SettingInspectionResult['effectiveLayer'],
  scope: SettingsWriteTarget,
): SettingsLayerId | null {
  if (effectiveLayer === 'default') return null

  const rank = (layer: SettingsLayerId) => SETTINGS_LAYER_ORDER.indexOf(layer)

  return rank(effectiveLayer) > rank(scope) ? effectiveLayer : null
}

function writeBlockedReason(
  settingScope: SettingScope,
  target: SettingsWriteTarget,
): string | null {
  if (layerAllowsScope(target, settingScope)) return null

  // The scope rule, stated where the user meets it. Workspace settings ship
  // inside a cloned repository, so anything reaching execution is user-only.
  return `${settingScope} settings can only be set in User settings`
}
