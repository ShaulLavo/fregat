export const MDX_FIXTURE = `import Card from './Card.jsx';
export const title = "שלום 🪐";

# Welcome {title}

Hello <Badge label="ready" /> world {user.name}!

**Strong prose** and **Across
lines** and \`literal {braces}\`.

<Card>

## Nested heading

Nested **bold text**.

</Card>

{items.map(item => <span key={item.id}>{item.name}</span>)}

\`\`\`sql
-- embedded comment
SELECT 42, 'hello';
\`\`\`

{/* JSX comment */}
`

export const MDX_CATEGORIES = [
  ['import', 'keyword'],
  ['"שלום 🪐"', 'string'],
  ['Welcome', 'text.title'],
  ['Badge', 'constructor'],
  ['span', 'tag'],
  ['label', 'attribute'],
  ['name', 'property'],
  ['Strong prose', 'text.strong'],
  ['Across\nlines', 'text.strong'],
  ['literal {braces}', 'text.literal'],
  ['Nested heading', 'text.title'],
  ['bold text', 'text.strong'],
  ['-- embedded comment', 'comment'],
  ['SELECT', 'keyword'],
  ['42', 'number'],
  ['/* JSX comment */', 'comment'],
] as const
