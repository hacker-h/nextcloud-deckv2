import MarkdownIt from 'markdown-it';

// Card descriptions are untrusted Markdown. Never enable embedded HTML.
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true });
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};

export function renderMarkdown(text = '') {
  return markdown.render(text);
}
