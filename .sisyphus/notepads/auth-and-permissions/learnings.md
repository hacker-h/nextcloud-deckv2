2026-08-01 Wave 1:
- Vitest v3 inline `test.projects` works for client jsdom + server node split; import config helper from `vitest/config`.
- Node's fetch client sends `Accept-Encoding: gzip, deflate` by default. When proxying through Node fetch and streaming to another client, force upstream `Accept-Encoding: identity`; otherwise live Deck responses can fail with double-decompression (`incorrect header check`).
- Node/browser clients normalize raw `../` in request URLs before the server sees them. Encoded slash traversal (`%2e%2e%2f...`) is the useful boundary test for server-side normalization.
