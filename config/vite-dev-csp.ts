import type { Plugin } from 'vite';

/**
 * Dev server only: Vite injects CSS as inline <style> tags, which the strict
 * `style-src 'self'` in index.html blocks, leaving the page unstyled. While
 * serving, add 'unsafe-inline' to style-src. Builds keep the strict policy
 * because they emit real .css files.
 */
export function devInlineStyles(): Plugin {
  return {
    name: 'witness:dev-inline-styles',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");
    },
  };
}
