export const SQL_FIXTURE = `-- שלום 🪐
WITH active AS (SELECT id, name FROM users WHERE enabled = true)
SELECT a."name", count(*) AS total, 42, 12.5, -7, +8, .5, 1., 6e2, 1.5e-3, '42', 'it''s SQL'
FROM active AS a JOIN orders AS o ON a.id = o.user_id
WHERE o.amount >= 12.5 GROUP BY a."name";
/* schema */
CREATE TABLE "audit" (id INTEGER PRIMARY KEY, message TEXT);
INSERT INTO "audit" (id, message) VALUES (42, 'hello');
`

export const SQL_CATEGORIES = [
  ['SELECT', 'keyword'],
  ['JOIN', 'keyword'],
  ['WITH', 'keyword'],
  ['CREATE', 'keyword'],
  ['INSERT', 'keyword'],
  ['"name"', 'property'],
  ['INTEGER', 'type.builtin'],
  ['-- שלום 🪐', 'comment'],
  ['/* schema */', 'comment'],
  ['42', 'number'],
  ['12.5', 'number'],
  ['-7', 'number'],
  ['+8', 'number'],
  ['.5', 'number'],
  ['1.', 'number'],
  ['6e2', 'number'],
  ['1.5e-3', 'number'],
  ["'42'", 'string'],
  ["'it''s SQL'", 'string'],
] as const
