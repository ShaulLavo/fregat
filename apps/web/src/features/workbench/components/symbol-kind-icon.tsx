import {
  BracketsCurlyIcon,
  CubeIcon,
  FunctionIcon,
  HashIcon,
  ListBulletsIcon,
  TagIcon,
  TextTIcon,
} from '@phosphor-icons/react'
import { cn } from '@workspace/ui/lib/utils'

const CLASS = 5
const METHOD = 6
const PROPERTY = 7
const FIELD = 8
const CONSTRUCTOR = 9
const ENUM = 10
const INTERFACE = 11
const FUNCTION = 12
const VARIABLE = 13
const CONSTANT = 14
const ENUM_MEMBER = 22
const STRUCT = 23

export function SymbolKindIcon({ className, kind }: { className?: string; kind: number }) {
  const iconClassName = cn('text-muted-foreground', className)
  if (kind === CLASS || kind === STRUCT) return <CubeIcon className={iconClassName} />
  if (kind === INTERFACE) return <BracketsCurlyIcon className={iconClassName} />
  if (kind === METHOD || kind === FUNCTION || kind === CONSTRUCTOR)
    return <FunctionIcon className={iconClassName} />
  if (kind === PROPERTY || kind === FIELD) return <TagIcon className={iconClassName} />
  if (kind === ENUM || kind === ENUM_MEMBER) return <ListBulletsIcon className={iconClassName} />
  if (kind === VARIABLE || kind === CONSTANT) return <HashIcon className={iconClassName} />

  return <TextTIcon className={iconClassName} />
}
