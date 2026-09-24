import { expect, it } from 'vitest';
import { renderMarkdown } from './markdown.js';

it('renders tables, nested lists, code and bare URLs', () => {
  const html = renderMarkdown('| Ort | Preis |\n| --- | --- |\n| Berg | 50 € |\n\n- Eins\n  - Zwei\n\n```js\nconst a = 1;\n```\n\nhttps://example.com');
  expect(html).toContain('<table>');
  expect(html.match(/<ul>/g)).toHaveLength(2);
  expect(html).toContain('<pre><code');
  expect(html).toContain('href="https://example.com"');
});

it('escapes embedded HTML and rejects executable links', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n[x](data:text/html;base64,WA==)');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('href=');
});
