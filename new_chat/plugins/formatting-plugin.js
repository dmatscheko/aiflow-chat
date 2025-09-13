/**
 * @fileoverview A plugin for formatting message content.
 * It handles Markdown rendering, syntax highlighting, KaTeX for math,
 * and wraps special elements like tool calls and thinking blocks in <details> tags.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {import('../chat-data.js').Message} Message
 */

const formattingPlugin = {
    /**
     * Formats the message content.
     * This hook is the core of the formatting process. It takes the content element,
         * performs a series of transformations, and populates it with the final HTML.
         * @param {HTMLElement} contentEl - The HTML element containing the raw message content.
         * @param {Message} message - The message object.
         */
        onFormatMessageContent(contentEl, message) {
            let text = contentEl.textContent || '';

            // 1. Pre-Markdown String Transformations (placeholders, etc.)
            //    These need to run before the markdown renderer to avoid
            //    it interfering with special syntax.

            // SVG normalization
            text = text.replace(/((?:```\w*?\s*?)|(?:<render_component[^>]*?>\s*?)|)(<svg[^>]*?>)([\s\S]*?)(<\/svg>(?:\s*?```|\s*?<\/render_component>|)|$)/gi,
                (match, prefix, svgStart, content, closing) => {
                    let output = '```svg\n' + svgStart;
                    if (closing?.startsWith('</svg>')) {
                        output += content + '</svg>\n```';
                    } else {
                        output += content; // Incomplete, don't add closing tags
                    }
                    return output;
                }
            );
            text = text.replace(/\(data:image\/svg\+xml,([a-z0-9_"'%+-]+?)\)/gmi, (match, g1) => {
                let data = decodeURIComponent(g1);
                data = data.replace(/<svg\s/gmi, '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ');
                return `(data:image/svg+xml,${encodeURIComponent(data)})`;
            });

            // Placeholder for tool calls
            text = text.replace(/<dma:tool_call[^>]+?name="([^>]*?)"[^>]*?(?:\/>|>[\s\S]*?<\/dma:tool_call\s*>)/gi, (match, name) => {
                const title = name || '';
                return `\n-#--#- TOOL CALL -#--#- ${title.trim()} -#--#-\n\`\`\`html\n${match.trim()}\n\`\`\`\n-#--#- END TOOL CALL -#--#-\n`;
            });

            // Placeholder for tool responses
            text = text.replace(/<dma:tool_response[^>]+?name="([^>]*?)"[^>]*?(?:\/>|>[\s\S]*?<\/dma:tool_response\s*>)/gi, (match, name) => {
                const title = name || '';
                return `\n-#--#- TOOL RESPONSE -#--#- ${title.trim()} -#--#-\n\`\`\`html\n${match.trim()}\n\`\`\`\n-#--#- END TOOL RESPONSE -#--#-\n`;
            });

            // Placeholder for <think> tags
            text = text.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, (match, content) => {
                return `\n-#--#- THINK -#--#-\n${content.trim()}\n-#--#- END THINK -#--#-\n`;
            });


            // 2. Markdown Rendering with Syntax Highlighting
            const md = window.markdownit({
                html: false,
                linkify: true,
                highlight: function (str, lang) {
                    if (lang && hljs.getLanguage(lang)) {
                        try {
                            return '<pre class="hljs"><code>' +
                                   hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                                   '</code></pre>';
                        } catch (__) {}
                    }
                    return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
                }
            });
            let html = md.render(text);

            // 3. Post-Markdown HTML Transformations

            const open = ' open'; // TODO: Make this conditional

            // Wrap tool calls in <details>
            html = html.replace(/-#--#- TOOL CALL -#--#- (.*?) -#--#-<\/p>([\s\S]*?)<p>-#--#- END TOOL CALL -#--#-/g, (match, name, content) => {
                const title = name ? `: ${name}` : '';
                return `<details${open} class="tool-call"><summary>Tool Call${title}</summary>${content}</details>`;
            });
            // Wrap tool responses in <details>
            html = html.replace(/-#--#- TOOL RESPONSE -#--#- (.*?) -#--#-<\/p>([\s\S]*?)<p>-#--#- END TOOL RESPONSE -#--#-/g, (match, name, content) => {
                const title = name ? `: ${name}` : '';
                return `<details${open} class="tool-response"><summary>Tool Response${title}</summary>${content}</details>`;
            });
            // Wrap thinking in <details>
            html = html.replace(/-#--#- THINK -#--#-<\/p>([\s\S]*?)<p>-#--#- END THINK -#--#-/g, (match, content) => {
                return `<details class="think"><summary>Thinking</summary><div class="think-content">${content}</div></details>`;
            });

            contentEl.innerHTML = html;

            // 4. Post-DOM Transformations (KaTeX)
            renderMathInElement(contentEl, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true }
                ],
                throwOnError: false
            });
        },

        /**
         * Adds copy-to-clipboard badges to code blocks and tables after the message is rendered.
         * @param {HTMLElement} messageEl - The fully constructed message element.
         * @param {Message} message - The message object.
         */
        onMessageRendered(messageEl, message) {
            messageEl.classList.add('hljs-message');
            const contentToCopy = message.value.content || '';
            messageEl.dataset.plaintext = encodeURIComponent(contentToCopy.trim());

            const tableToCSV = (table) => {
                const separator = ';';
                const rows = table.querySelectorAll('tr');
                return Array.from(rows).map(row =>
                    Array.from(row.querySelectorAll('td, th')).map(col =>
                        `"${col.innerText.replace(/(\r\n|\n|\r)/gm, '').replace(/(\s\s)/gm, ' ').replace(/"/g, '""')}"`
                    ).join(separator)
                ).join('\n');
            };

            messageEl.querySelectorAll('table').forEach(table => {
                const div = document.createElement('div');
                div.classList.add('hljs-nobg', 'language-table');
                div.dataset.plaintext = encodeURIComponent(tableToCSV(table));
                const pe = table.parentElement;
                pe.insertBefore(div, table);
                div.appendChild(table);
            });

            const clipBadge = new ClipBadge({ autoRun: false });
            clipBadge.addTo(messageEl);

            const titleRow = messageEl.querySelector('.message-title');
            if (titleRow) {
                titleRow.style.paddingRight = '40px';
            }
        }
};

pluginManager.register(formattingPlugin);


/**
 * @class ClipBadge
 * Provides copy-to-clipboard badges for code blocks.
 * Adapted from https://unpkg.com/highlightjs-badge@0.1.9/highlightjs-badge.js
 */
class ClipBadge {
    constructor(options = {}) {
        this.settings = { ...this.defaults, ...options };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    defaults = {
        templateSelector: '#clip-badge-template',
        copyIconContent: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-4H4a2 2 0 0 1-2-2V4zm8 12v4h10V10h-4v4a2 2 0 0 1-2 2h-4zm4-2V4H4v10h10z" fill="currentColor"/></svg>',
        checkIconContent: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.664 5.253a1 1 0 0 1 .083 1.411l-10.666 12a1 1 0 0 1-1.495 0l-5.333-6a1 1 0 0 1 1.494-1.328l4.586 5.159 9.92-11.16a1 1 0 0 1 1.411-.082z" fill="currentColor"/></svg>&nbsp;Copied!',
        autoRun: true,
    };

    init() {
        const node = this.getTemplate();
        if(!document.head.querySelector('#clip-badge-styles')) {
            const style = node.content.querySelector('style').cloneNode(true);
            style.id = 'clip-badge-styles';
            document.head.appendChild(style);
        }
        this.settings.template = node.content.querySelector('.clip-badge').cloneNode(true);
        if (this.settings.autoRun) this.addAll();
    }

    getTemplate() {
        let node = document.querySelector(this.settings.templateSelector);
        if (!node) {
            node = document.createElement('template');
            node.id = 'clip-badge-template';
            node.innerHTML = `
                <style>
                    .clip-badge-pre { position: relative; }
                    .clip-badge { display: flex; position: absolute; top: 0; right: 0; opacity: 0.3; transition: opacity 0.4s; }
                    .clip-badge:hover { opacity: .95; }
                    .clip-badge-copy-icon { cursor: pointer; padding: 5px 8px; user-select: none; background: #444; border-radius: 0 5px 0 7px; }
                    .clip-badge-copy-icon * { vertical-align: top; }
                    .text-success { color: limegreen !important; }
                </style>
                <div class="clip-badge">
                    <div class="clip-badge-copy-icon" title="Copy to clipboard"></div>
                </div>`;
            document.body.appendChild(node);
        }
        return node;
    }

    addAll() {
        document.querySelectorAll('pre.hljs').forEach(el => this.addBadge(el));
    }

    addTo(container) {
        container.querySelectorAll('pre.hljs, .language-table').forEach(el => this.addBadge(el));
        if (container.classList.contains('hljs-message')) {
            this.addBadge(container);
        }
    }

    addBadge(highlightEl) {
        if (highlightEl.classList.contains('clip-badge-pre')) return;
        highlightEl.classList.add('clip-badge-pre');
        const badge = this.createBadgeElement(highlightEl);
        highlightEl.insertAdjacentElement('afterbegin', badge);
    }

    createBadgeElement(highlightEl) {
        const codeBlock = highlightEl.querySelector('code');
        const plainText = highlightEl.dataset.plaintext ? decodeURIComponent(highlightEl.dataset.plaintext) : (codeBlock ? codeBlock.textContent : highlightEl.textContent);
        let htmlText = '';
        if (highlightEl.classList.contains('language-table')) {
            htmlText = highlightEl.innerHTML;
        }

        const badge = this.settings.template.cloneNode(true);
        const copyIcon = badge.querySelector('.clip-badge-copy-icon');
        copyIcon.innerHTML = this.settings.copyIconContent;

        copyIcon.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (copyIcon.classList.contains('text-success')) return;

            const setCopied = () => {
                copyIcon.innerHTML = this.settings.checkIconContent;
                copyIcon.classList.add('text-success');
                setTimeout(() => {
                    copyIcon.innerHTML = this.settings.copyIconContent;
                    copyIcon.classList.remove('text-success');
                }, 2000);
            };

            if (navigator.clipboard?.write) {
                const clipboardData = { 'text/plain': new Blob([plainText], { type: 'text/plain' }) };
                if (htmlText) {
                    clipboardData['text/html'] = new Blob([htmlText], { type: 'text/html' });
                }
                navigator.clipboard.write([new ClipboardItem(clipboardData)]).then(setCopied).catch(err => {
                    console.error('Clipboard API failed', err);
                });
            } else {
                 navigator.clipboard.writeText(plainText).then(setCopied).catch(err => {
                    console.error('Clipboard API failed', err);
                });
            }
        });
        return badge;
    }
}
