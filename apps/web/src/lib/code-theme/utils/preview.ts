export const CODE_THEME_PREVIEW_SAMPLE = [
  '// Format a project for the sidebar.',
  'type Project = { name: string; stars: number };',
  '',
  'export function formatProject(project: Project) {',
  '  const { name, stars } = project;',
  '  return `${name} has ${stars} stars`;',
  '}',
  '',
  'formatProject({ name: "Platform", stars: 128 });',
].join('\n')
