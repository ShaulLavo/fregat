import {
  EnvelopeSimpleIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  PresentationChartIcon,
  SlackLogoIcon,
  TableIcon,
  type Icon,
} from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

import { useAttachToComposer } from '@/features/chat/hooks/use-attach-to-composer'
import {
  artifactTemplateLabel,
  artifactTemplateUsePrompt,
  type ArtifactTemplate,
  type ArtifactTemplateKind,
} from '@/features/chat/utils/artifact-templates'

const ICON_BY_KIND: Record<ArtifactTemplateKind, Icon> = {
  document: FileTextIcon,
  presentation: PresentationChartIcon,
  spreadsheet: TableIcon,
  site: GlobeIcon,
  'google-docs': FileTextIcon,
  'google-slides': PresentationChartIcon,
  'google-sheets': TableIcon,
  image: ImageIcon,
  email: EnvelopeSimpleIcon,
  slack: SlackLogoIcon,
}

/** A template the agent made, with one action: add its prompt to the composer. */
export function ArtifactTemplateCard({ template }: { readonly template: ArtifactTemplate }) {
  const { appendText } = useAttachToComposer()
  const KindIcon = ICON_BY_KIND[template.artifactKind]
  const label = artifactTemplateLabel(template.artifactKind)

  return (
    <div
      className='bg-muted my-2 flex min-w-0 items-center gap-3 rounded-lg px-3 py-2'
      data-artifact-kind={template.artifactKind}
      title={template.skillDirectory}
    >
      <KindIcon aria-hidden='true' className='text-muted-foreground size-(--icon-size) shrink-0' />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='text-foreground truncate text-sm font-medium'>{template.displayName}</span>
        <span className='text-muted-foreground truncate text-xs'>{label}</span>
      </div>
      <Button
        size='sm'
        type='button'
        variant='outline'
        onClick={() => appendText('artifact-template', artifactTemplateUsePrompt(template))}
      >
        Use
      </Button>
    </div>
  )
}
