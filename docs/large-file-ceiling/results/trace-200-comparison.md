# 200 MiB trace comparison, 2026-09-28

Pre-tier integration versus final resident run. Whole-trace durations include open, waits, typing, save and measurement work; this is not an isolated typing comparison. No captured source maps were supplied.

| metric          | before  | after   | delta    |
| --------------- | ------- | ------- | -------- |
| duration ms     | 30413.3 | 23683.2 | -6730.1  |
| scripting ms    | 13967.3 | 1859.9  | -12107.4 |
| layout ms       | 77.9    | 56.5    | -21.4    |
| paint ms        | 234.3   | 191.6   | -42.7    |
| tasks over 16ms | 20      | 15      | -5       |
| tasks over 50ms | 14      | 8       | -6       |
| worst task ms   | 4968.1  | 4968    | -0.1     |
