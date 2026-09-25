import {
  artifactTemplateCopyText,
  artifactTemplateUsePrompt,
  resolveArtifactTemplate,
  splitArtifactTemplateMarkdown,
  type ArtifactTemplate,
} from '@/features/chat/utils/artifact-templates'
import { appendOnce } from '@/features/chat/utils/append-once'
import { expect, test } from '../../../../../test/fixtures'

const TEMPLATE: ArtifactTemplate = {
  artifactKind: 'document',
  displayName: 'Hello World',
  skillDirectory: '/Users/test/.codex/skills/artifact-template-hello-world',
  skillName: 'artifact-template-hello-world',
}
const DIRECTIVE =
  '::artifact-template{artifact_kind="document" display_name="Hello World" skill_directory="/Users/test/.codex/skills/artifact-template-hello-world" skill_name="artifact-template-hello-world"}'

test('accepts the template metadata Codex emits and rejects malformed metadata', () => {
  const valid = {
    artifact_kind: 'document',
    display_name: '  Hello World  ',
    skill_directory: TEMPLATE.skillDirectory,
    skill_name: TEMPLATE.skillName,
  }
  expect(resolveArtifactTemplate(valid)).toEqual(TEMPLATE)
  expect(
    resolveArtifactTemplate({ ...valid, skill_directory: String.raw`C:\skills\t` }),
  ).not.toBeNull()
  for (const override of [
    { artifact_kind: 'unknown' },
    { display_name: ' ' },
    { skill_directory: 'relative/template' },
    { skill_directory: 'javascript:alert(1)' },
    { skill_name: 'hello-world' },
    { gallery_kind: 'unknown' },
  ]) {
    expect(resolveArtifactTemplate({ ...valid, ...override })).toBeNull()
  }
})

test('splits a directive line into a card between the Markdown around it', () => {
  expect(splitArtifactTemplateMarkdown(`Made it.\n\n${DIRECTIVE}\n\nUse it any time.`)).toEqual([
    { kind: 'markdown', markdown: 'Made it.\n' },
    { kind: 'artifact-template', template: TEMPLATE },
    { kind: 'markdown', markdown: '\nUse it any time.' },
  ])
})

test('leaves a malformed directive and one inside a code fence as literal Markdown', () => {
  const malformed = '::artifact-template{artifact_kind="document" skill_name="x"}'
  expect(splitArtifactTemplateMarkdown(malformed)).toEqual([
    { kind: 'markdown', markdown: malformed },
  ])
  const fenced = `\`\`\`md\n${DIRECTIVE}\n\`\`\``
  expect(splitArtifactTemplateMarkdown(fenced)).toEqual([{ kind: 'markdown', markdown: fenced }])
})

test('holds an unfinished directive while streaming, then settles into one card', () => {
  const partial = `Made it.\n${DIRECTIVE.slice(0, 40)}`
  expect(splitArtifactTemplateMarkdown(partial, true)).toEqual([
    { kind: 'markdown', markdown: 'Made it.' },
  ])
  expect(
    splitArtifactTemplateMarkdown(`Made it.\n${DIRECTIVE}`, true).filter(
      (segment) => segment.kind === 'artifact-template',
    ),
  ).toHaveLength(1)
})

test('appends the use prompt once, with a separating space', () => {
  const prompt = artifactTemplateUsePrompt(TEMPLATE)
  expect(prompt).toBe('Create a document using this $artifact-template-hello-world about…')
  expect(appendOnce('', prompt)).toBe(prompt)
  expect(appendOnce('Please:', prompt)).toBe(`Please: ${prompt}`)
  expect(appendOnce(`Please: ${prompt}`, prompt)).toBe(`Please: ${prompt}`)
})

test('copies a card as its name and kind', () => {
  expect(artifactTemplateCopyText(`Made it.\n${DIRECTIVE}`)).toBe(
    'Made it.\nHello World (Document template)',
  )
})
