export type TreeSitterLanguageId = string

export type TreeSitterLanguageAssets = {
  readonly wasmUrl: string
  readonly highlightQuerySource?: string
  readonly foldQuerySource?: string
  readonly injectionQuerySource?: string
  readonly mergeUnitQuerySource?: string
}

type TreeSitterLanguageContributionMetadata = {
  readonly id: TreeSitterLanguageId
  readonly extensions?: readonly string[]
  readonly aliases?: readonly string[]
  readonly filenames?: readonly string[]
  readonly injectionDependencies?: readonly string[]
}

type TreeSitterInlineLanguageContribution = TreeSitterLanguageContributionMetadata &
  TreeSitterLanguageAssets & {
    readonly load?: never
  }

type TreeSitterLazyLanguageContribution = TreeSitterLanguageContributionMetadata & {
  readonly load: () => Promise<TreeSitterLanguageAssets>
}

export type TreeSitterLanguageContribution =
  | TreeSitterInlineLanguageContribution
  | TreeSitterLazyLanguageContribution

export type TreeSitterLanguageDescriptor = TreeSitterLanguageContributionMetadata &
  TreeSitterLanguageAssets & {
    readonly extensions: readonly string[]
    readonly aliases: readonly string[]
  }

export type TreeSitterLanguageRegistrationOptions = {
  readonly replace?: boolean
}

export type TreeSitterLanguageDisposable = {
  dispose(): void
}

export type TreeSitterLanguageResolver = {
  resolveTreeSitterLanguage(
    languageId: TreeSitterLanguageId,
  ): Promise<TreeSitterLanguageDescriptor | null>
}

type TreeSitterLanguageRegistration = {
  readonly contribution: TreeSitterLanguageContribution
  readonly id: TreeSitterLanguageId
  readonly aliases: readonly string[]
  descriptorPromise: Promise<TreeSitterLanguageDescriptor> | null
}

export class TreeSitterLanguageRegistry implements TreeSitterLanguageResolver {
  private readonly registrations: TreeSitterLanguageRegistration[] = []

  public registerLanguage(
    contribution: TreeSitterLanguageContribution,
    options: TreeSitterLanguageRegistrationOptions = {},
  ): TreeSitterLanguageDisposable {
    const registration = createRegistration(contribution)
    this.assertCanRegister(registration.id, options)
    this.registrations.push(registration)

    return {
      dispose: () => this.unregisterLanguage(registration),
    }
  }

  public hasLanguage(languageId: string | null | undefined): boolean {
    const id = normalizeOptionalLanguageId(languageId)
    if (!id) return false
    return this.activeRegistrationForId(id) !== null
  }

  public resolveLanguageAlias(alias: string | null | undefined): TreeSitterLanguageId | null {
    const normalized = normalizeOptionalAlias(alias)
    if (!normalized) return null

    const registration = this.findActiveRegistration((candidate) => {
      if (candidate.id.toLowerCase() === normalized) return true
      return candidate.aliases.includes(normalized)
    })
    return registration?.id ?? null
  }

  public async resolveTreeSitterLanguage(
    languageId: TreeSitterLanguageId,
  ): Promise<TreeSitterLanguageDescriptor | null> {
    const id = this.resolveLanguageAlias(languageId) ?? normalizeLanguageId(languageId)
    const registration = this.activeRegistrationForId(id)
    if (!registration) return null

    if (!registration.descriptorPromise) {
      registration.descriptorPromise = resolveTreeSitterLanguageContribution(
        registration.contribution,
      )
    }

    return registration.descriptorPromise
  }

  public clear(): void {
    this.registrations.length = 0
  }

  private assertCanRegister(
    languageId: TreeSitterLanguageId,
    options: TreeSitterLanguageRegistrationOptions,
  ): void {
    if (options.replace) return
    if (!this.hasLanguage(languageId)) return

    throw new Error(`Tree-sitter language "${languageId}" is already registered`)
  }

  private unregisterLanguage(registration: TreeSitterLanguageRegistration): void {
    const index = this.registrations.indexOf(registration)
    if (index === -1) return

    this.registrations.splice(index, 1)
  }

  private findActiveRegistration(
    predicate: (registration: TreeSitterLanguageRegistration) => boolean,
  ): TreeSitterLanguageRegistration | null {
    for (let index = this.registrations.length - 1; index >= 0; index -= 1) {
      const registration = this.registrations[index]!
      if (!this.isActiveRegistration(registration)) continue
      if (predicate(registration)) return registration
    }

    return null
  }

  private activeRegistrationForId(
    languageId: TreeSitterLanguageId,
  ): TreeSitterLanguageRegistration | null {
    for (let index = this.registrations.length - 1; index >= 0; index -= 1) {
      const registration = this.registrations[index]!
      if (registration.id === languageId) return registration
    }

    return null
  }

  private isActiveRegistration(registration: TreeSitterLanguageRegistration): boolean {
    return this.activeRegistrationForId(registration.id) === registration
  }
}

export const createTreeSitterLanguageRegistry = (): TreeSitterLanguageRegistry =>
  new TreeSitterLanguageRegistry()

export const resolveTreeSitterLanguageContribution = async (
  contribution: TreeSitterLanguageContribution,
): Promise<TreeSitterLanguageDescriptor> => {
  const assets = await loadTreeSitterLanguageAssets(contribution)
  return createTreeSitterLanguageDescriptor(contribution, assets)
}

/** A language's descriptor followed by every language its injection queries name, transitively. */
export const resolveTreeSitterLanguageClosure = async (
  resolver: TreeSitterLanguageResolver,
  languageId: TreeSitterLanguageId,
  isCancelled: () => boolean = () => false,
): Promise<readonly TreeSitterLanguageDescriptor[]> => {
  const descriptor = await resolver.resolveTreeSitterLanguage(languageId)
  if (!descriptor || isCancelled()) return []
  return withInjectedLanguages(resolver, descriptor, isCancelled)
}

const withInjectedLanguages = async (
  resolver: TreeSitterLanguageResolver | undefined,
  descriptor: TreeSitterLanguageDescriptor,
  isCancelled: () => boolean,
): Promise<readonly TreeSitterLanguageDescriptor[]> => {
  const descriptors = [descriptor]
  const seen = new Set([descriptor.id])
  for (let index = 0; index < descriptors.length; index += 1) {
    const dependencies = descriptors[index]?.injectionDependencies ?? []
    for (const id of dependencies) {
      if (seen.has(id) || isCancelled()) continue
      seen.add(id)
      const injected = await resolver?.resolveTreeSitterLanguage(id)
      if (injected) descriptors.push(injected)
    }
  }
  return descriptors
}

export const resolveTreeSitterLanguageAlias = (
  alias: string | null | undefined,
  registry?: TreeSitterLanguageRegistry,
): TreeSitterLanguageId | null => registry?.resolveLanguageAlias(alias) ?? null

export const isTreeSitterLanguageId = (
  languageId: string | null | undefined,
): languageId is TreeSitterLanguageId => normalizeOptionalLanguageId(languageId) !== null

const createRegistration = (
  contribution: TreeSitterLanguageContribution,
): TreeSitterLanguageRegistration => ({
  contribution,
  id: normalizeLanguageId(contribution.id),
  aliases: uniqueItems((contribution.aliases ?? []).map(normalizeAlias)),
  descriptorPromise: null,
})

const createTreeSitterLanguageDescriptor = (
  contribution: TreeSitterLanguageContribution,
  assets: TreeSitterLanguageAssets,
): TreeSitterLanguageDescriptor => ({
  id: normalizeLanguageId(contribution.id),
  extensions: uniqueItems((contribution.extensions ?? []).map(normalizeExtension)),
  aliases: uniqueItems((contribution.aliases ?? []).map(normalizeAlias)),
  filenames: contribution.filenames ?? [],
  injectionDependencies: contribution.injectionDependencies ?? [],
  wasmUrl: normalizeWasmUrl(assets.wasmUrl, contribution.id),
  highlightQuerySource: assets.highlightQuerySource,
  foldQuerySource: assets.foldQuerySource,
  injectionQuerySource: assets.injectionQuerySource,
  mergeUnitQuerySource: assets.mergeUnitQuerySource,
})

const loadTreeSitterLanguageAssets = async (
  contribution: TreeSitterLanguageContribution,
): Promise<TreeSitterLanguageAssets> => {
  if ('load' in contribution && contribution.load) return contribution.load()
  return contribution
}

const normalizeOptionalLanguageId = (
  languageId: string | null | undefined,
): TreeSitterLanguageId | null => {
  if (!languageId) return null

  const id = languageId.trim()
  return id.length > 0 ? id : null
}

const normalizeLanguageId = (languageId: string): TreeSitterLanguageId => {
  const id = normalizeOptionalLanguageId(languageId)
  if (id) return id

  throw new Error('Tree-sitter language id cannot be empty')
}

const normalizeOptionalAlias = (alias: string | null | undefined): string | null => {
  if (!alias) return null

  const normalized = alias.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

const normalizeAlias = (alias: string): string => {
  const normalized = normalizeOptionalAlias(alias)
  if (normalized) return normalized

  throw new Error('Tree-sitter language alias cannot be empty')
}

const normalizeExtension = (extension: string): string => {
  const normalized = extension.trim().toLowerCase()
  if (!normalized) throw new Error('Tree-sitter language extension cannot be empty')
  if (normalized.startsWith('.')) return normalized
  return `.${normalized}`
}

const normalizeWasmUrl = (wasmUrl: string, languageId: string): string => {
  const normalized = wasmUrl.trim()
  if (normalized) return normalized

  throw new Error(`Tree-sitter language "${languageId}" is missing a wasmUrl`)
}

const uniqueItems = <T>(items: readonly T[]): readonly T[] => Array.from(new Set(items))
