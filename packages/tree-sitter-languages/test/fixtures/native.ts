import { SQL_FIXTURE } from './sql'

export const NATIVE_FIXTURES = [
  { id: 'sql', text: SQL_FIXTURE, captures: ['keyword', 'number', 'string', 'comment'] },
  {
    id: 'javascript',
    text: 'const greet = (name) => `Hi ${name}`; // 🪐\n',
    captures: ['keyword.declaration', 'string', 'comment'],
  },
  {
    id: 'typescript',
    text: 'const n: number = <number>value; // 🪐\n',
    captures: ['keyword.declaration', 'type.builtin', 'comment'],
  },
  {
    id: 'tsx',
    text: 'const node = <div><Card title="hello">{name}</Card></div>; // 🪐\n',
    captures: ['tag', 'string', 'comment'],
  },
  {
    id: 'html',
    text: '<!-- 🪐 --><div title="hello">World</div>\n',
    captures: ['tag', 'attribute', 'string', 'comment'],
  },
  {
    id: 'css',
    text: '/* 🪐 */ h1 { color: red; content: "hi"; }\n',
    captures: ['property', 'string', 'comment'],
  },
  {
    id: 'json',
    text: '{"message": "hello\\n🪐", "count": 42}\n',
    captures: ['string', 'string.escape', 'number'],
  },
  { id: 'markdown', text: '# Title 🪐\n\n**bold** and `code`\n', captures: ['text.title'] },
  {
    id: 'astro',
    text: '---\nconst title = "🪐"\n---\n<!-- note --><Card title={title}>{title}</Card>\n',
    captures: ['tag', 'attribute', 'comment'],
  },
  {
    id: 'python',
    text: '# 🪐\ndef greet(name):\n    return "hello"\n',
    captures: ['keyword', 'function', 'string', 'comment'],
  },
  {
    id: 'shellscript',
    text: '# 🪐\nprintf "hello"\n',
    captures: ['function', 'string', 'comment'],
  },
  {
    id: 'rust',
    text: '// 🪐\nfn main() { let name = "hello"; }\n',
    captures: ['keyword', 'function', 'string', 'comment'],
  },
  {
    id: 'go',
    text: 'package main\n// 🪐\nfunc main() { println("hello") }\n',
    captures: ['keyword', 'function', 'string', 'comment'],
  },
  {
    id: 'yaml',
    text: '# 🪐\nname: "hello"\nenabled: true\n',
    captures: ['property', 'string', 'constant.builtin', 'comment'],
  },
  {
    id: 'toml',
    text: '# 🪐\nname = "hello"\nenabled = true\n',
    captures: ['property', 'string', 'constant.builtin', 'comment'],
  },
  {
    id: 'c',
    text: '// 🪐\nint main() { return 42; }\n',
    captures: ['type', 'function', 'number', 'comment'],
  },
  {
    id: 'cpp',
    text: '// 🪐\nclass Box {};\nint main() { return 42; }\n',
    captures: ['type', 'function', 'number', 'comment'],
  },
  {
    id: 'csharp',
    text: '// 🪐\nclass Box { string name = "hello"; }\n',
    captures: ['keyword', 'type', 'string', 'comment'],
  },
  {
    id: 'java',
    text: '// 🪐\nclass Box { String name = "hello"; }\n',
    captures: ['keyword', 'type', 'string', 'comment'],
  },
  {
    id: 'php',
    text: '<?php\n// 🪐\nfunction greet() { return "hello"; }\n',
    captures: ['keyword', 'function', 'string', 'comment'],
  },
  {
    id: 'lua',
    text: '-- 🪐\nlocal function greet(name) return "hello" end\n',
    captures: ['keyword', 'function', 'string', 'comment'],
  },
  {
    id: 'svelte',
    text: '<!-- 🪐 --><script>let name = "hi";</script><h1>{name}</h1><style>h1 { color: red }</style>\n',
    captures: ['tag', 'comment'],
  },
] satisfies readonly { id: string; text: string; captures: readonly string[] }[]
