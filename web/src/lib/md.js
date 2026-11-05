// Markdown 渲染：支持公式（KaTeX），渲染结果经过 DOMPurify 清洗
import MarkdownIt from 'markdown-it';
import mk from '@vscode/markdown-it-katex';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
md.use(mk.default || mk, { throwOnError: false });

const defaultLink = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return defaultLink(tokens, idx, options, env, self);
};

export function renderMd(src) {
  return DOMPurify.sanitize(md.render(src || ''), { ADD_ATTR: ['target'] });
}
