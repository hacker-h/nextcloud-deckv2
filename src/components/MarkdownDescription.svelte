<script>
  import { renderMarkdown } from '../lib/markdown.js';
  let { text = '' } = $props();
  const html = $derived(renderMarkdown(text));
</script>

<div class="markdown-description" data-testid="description">{@html html}</div>

<style>
  .markdown-description { line-height: inherit; overflow-wrap: anywhere; min-width: 0; }
  .markdown-description :global(p) { margin: 1em 0; }
  .markdown-description :global(ul),
  .markdown-description :global(ol) { margin: .5em 0 1em; padding-left: 1.75em; }
  .markdown-description :global(li) { margin: .3em 0; }
  .markdown-description :global(li > p) { margin: .3em 0; }
  .markdown-description :global(h1),
  .markdown-description :global(h2),
  .markdown-description :global(h3),
  .markdown-description :global(h4),
  .markdown-description :global(h5),
  .markdown-description :global(h6) { margin: 1.2em 0 .5em; line-height: 1.3; font-size: 1.15em; }
  .markdown-description :global(a) { color: #85b8ff; text-decoration: underline; }
  .markdown-description :global(pre) { overflow-x: auto; padding: 12px; background: #171c20; border-radius: 4px; }
  .markdown-description :global(code) { white-space: pre-wrap; font-family: monospace; }
  .markdown-description :global(blockquote) { margin: 1em 0; padding-left: 1em; border-left: 3px solid #738496; }
  .markdown-description :global(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
  .markdown-description :global(th),
  .markdown-description :global(td) { padding: 6px 10px; border: 1px solid #738496; }
  .markdown-description :global(img) { max-width: 100%; height: auto; }
</style>
