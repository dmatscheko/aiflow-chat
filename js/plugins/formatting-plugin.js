/**
 * @fileoverview A collection of plugins for formatting message content.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {import('../chat-data.js').Message} Message
 */

// --- Main Formatting Plugin ---

const formattingPlugin = {
    /**
     * Formats the raw text content of a message into HTML.
     * This hook handles all transformations that convert the raw string content
     * into the rich HTML that will be displayed to the user.
     * @param {HTMLElement} contentEl - The content element, initially containing raw text.
     * @param {Message} message - The message object.
     * @returns {HTMLElement} The modified content element.
     */
    onFormatMessageContent(contentEl, message) {
        let text = contentEl.textContent || '';

        // Pipeline of text-to-text transformations
        text = this.formatSvg(text);
        text = this.prewrapDetails(text);

        // Render Markdown to HTML
        let html = this.renderMarkdown(text);
        contentEl.innerHTML = html;

        // Pipeline of DOM transformations on the newly created content
        this.wrapDetails(contentEl, message);
        this.renderKatex(contentEl);

        return contentEl;
    },

    /**
     * Performs final processing on the message element after it's fully rendered.
     * This hook is used for adding interactive UI elements like copy badges.
     * @param {HTMLElement} messageEl - The fully rendered message element.
     * @param {Message} message - The message object.
     * @returns {HTMLElement} The modified message element.
     */
    onMessageRendered(messageEl, message) {
        this.addClipBadges(messageEl, message);
        return messageEl;
    },

    /**
     * Normalizes SVG content by wrapping it in ```svg blocks.
     * @param {string} text - The text content to format.
     * @returns {string} The formatted text.
     */
    formatSvg(text) {
        text = text.replace(/((?:```\w*?\s*?)|(?:<render_component[^>]*?>\s*?)|)(<svg[^>]*?>)([\s\S]*?)(<\/svg>(?:\s*?```|\s*?<\/render_component>|)|$)/gi,
            (match, prefix, svgStart, content, closing) => {
                let output = '```svg\n' + svgStart;
                if (closing?.startsWith('</svg>')) {
                    output += content + '</svg>\n```';
                } else {
                    output += content;
                }
                return output;
            }
        );
        return text;
    },

    /**
     * Wraps tool calls and thoughts in special placeholder tags to protect them
     * from the Markdown renderer.
     * @param {string} text - The text content to format.
     * @returns {string} The formatted text.
     */
    prewrapDetails(text) {
        text = text.replace(/<dma:tool_call[^>]+?name="([^>]*?)"[^>]*?(?:\/>|>[\s\S]*?<\/dma:tool_call\s*>)/gi, (match, name) => {
            const title = name || '';
            return `\n-#--#- TOOL CALL -#--#- ${title.trim()} -#--#-\n\`\`\`html\n${match.trim()}\n\`\`\`\n-#--#- END TOOL CALL -#--#-\n`;
        });
        text = text.replace(/<dma:tool_response[^>]+?name="([^>]*?)"[^>]*?(?:\/>|>[\s\S]*?<\/dma:tool_response\s*>)/gi, (match, name) => {
            const title = name || '';
            return `\n-#--#- TOOL RESPONSE -#--#- ${title.trim()} -#--#-\n\`\`\`html\n${match.trim()}\n\`\`\`\n-#--#- END TOOL RESPONSE -#--#-\n`;
        });
        text = text.replace(/<think>([\s\S]*?)<\/think>/g, '<p>-#--#- THINK -#--#-</p><div>$1</div><p>-#--#- END THINK -#--#-</p>');
        text = text.replace(/<think>([\s\S]*)$/, '<p>-#--#- THINK -#--#-</p><div>$1</div>'); // Unmatched <think>
        return text;
    },

    /**
     * Renders Markdown to HTML using markdown-it and highlight.js.
     * @param {string} text - The text content to format.
     * @returns {string} The formatted HTML string.
     */
    renderMarkdown(text) {
        const md = window.markdownit({
            html: true, // Allow HTML since we are injecting it for <details>
            linkify: true,
            highlight: function (code, language) {
                let value = '';
                try {
                    if (language && hljs.getLanguage(language)) {
                        value = hljs.highlight(code, { language, ignoreIllegals: true }).value;
                    } else {
                        const highlighted = hljs.highlightAuto(code);
                        language = highlighted.language || 'unknown';
                        value = highlighted.value;
                    }
                } catch (error) {
                    console.error('Highlight error:', error, code);
                }
                return `<pre class="hljs language-${language}" data-plaintext="${encodeURIComponent(code.trim())}"><code>${value}</code></pre>`;
            }
        });
        md.validateLink = link => !['javascript:', 'dma:'].some(prefix => link.startsWith(prefix));
        return md.render(text);
    },

    /**
     * Converts the placeholder tags into final <details> blocks.
     * @param {HTMLElement} contentEl - The content element.
     * @param {Message} message - The message object.
     */
    wrapDetails(contentEl, message) {
        let html = contentEl.innerHTML;
        const open = message.id === 0 ? ' open' : '';

        html = html.replace(/-#--#- TOOL CALL -#--#- (.*?) -#--#-<\/p>([\s\S]*?)<p>-#--#- END TOOL CALL -#--#-/g, (match, name, content) => {
            const title = name ? ': ' + name : '';
            return `<details${open} class="tool-call"><summary>Tool Call${title}</summary>${content}</details>`;
        });
        html = html.replace(/-#--#- TOOL RESPONSE -#--#- (.*?) -#--#-<\/p>([\s\S]*?)<p>-#--#- END TOOL RESPONSE -#--#-/g, (match, name, content) => {
            const title = name ? ': ' + name : '';
            return `<details${open} class="tool-response"><summary>Tool Response${title}</summary>${content}</details>`;
        });
        html = html.replace(/-#--#- THINK -#--#-<\/p>([\s\S]*?)<p>-#--#- END THINK -#--#-<\/p>/g, (match, content) => {
            return `<details class="think"><summary>Thinking</summary><div class="think-content">${content}</div></details>`;
        });
        html = html.replace(/-#--#- THINK -#--#-<\/p>([\s\S]*)/g, (match, content) => {
            return `<details open class="think"><summary>Thinking</summary><div class="think-content">${content}</div></details>`;
        });

        contentEl.innerHTML = html;
    },

    /**
     * Renders LaTeX math using KaTeX.
     * @param {HTMLElement} wrapper - The element containing math to render.
     */
    renderKatex(wrapper) {
        const origFormulas = [];
        renderMathInElement(wrapper, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
                { left: '\\[', right: '\\]', display: true }
            ],
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
            throwOnError: false,
            preProcess: math => {
                origFormulas.push(math);
                return math;
            }
        });
        wrapper.querySelectorAll('.katex').forEach((elem, i) => {
            if (i >= origFormulas.length) return;
            const originalFormula = origFormulas[i].trim();
            elem.dataset.plaintext = encodeURIComponent(originalFormula);

            if (elem.parentElement.classList.contains('katex-display')) {
                const div = document.createElement('div');
                div.classList.add('hljs', 'language-latex');
                div.dataset.plaintext = encodeURIComponent(originalFormula);

                const container = elem.parentElement;
                container.parentElement.insertBefore(div, container);
                div.appendChild(container);
            }
        });
    },

    /**
     * Adds copy-to-clipboard badges to various elements.
     * @param {HTMLElement} messageEl - The message element.
     * @param {Message} message - The message object.
     */
    addClipBadges(messageEl, message) {
        messageEl.classList.add('hljs-nobg', 'hljs-message');
        messageEl.dataset.plaintext = encodeURIComponent(message.value.content.trim());

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
            div.classList.add('hljs-nobg', 'hljs-table', 'language-table');
            div.dataset.plaintext = encodeURIComponent(tableToCSV(table));
            table.parentElement.insertBefore(div, table);
            div.appendChild(table);
        });

        const clipBadge = new ClipBadge({ autoRun: false });
        clipBadge.addTo(messageEl);
    }
};

pluginManager.register(formattingPlugin);


/**
 * @class ClipBadge
 * Provides copy-to-clipboard badges for code blocks, tables, and formulas.
 * Adapted from highlightjs-badge.
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
        codeButtonContent: 'Code',
        imageButtonContent: 'Image',
        autoRun: true,
    };

    init() {
        const node = this.getTemplate();
        if (!document.head.querySelector('#clip-badge-styles')) {
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
                    .clip-badge { display: flex; flex-flow: row nowrap; align-items: flex-start; position: absolute; top: 0; right: 0; opacity: 0.3; transition: opacity 0.4s; z-index: 10; }
                    .clip-badge:hover { opacity: .95; }
                    .clip-badge-language { margin-right: 10px; margin-top: 2px; font-weight: 600; color: goldenrod; }
                    .clip-badge-copy-icon { cursor: pointer; padding: 5px 8px; user-select: none; background: #444; border-radius: 0 5px 0 7px; }
                    .clip-badge-copy-icon * { vertical-align: top; }
                    .text-success { color: limegreen !important; }
                    .clip-badge-swap { cursor: pointer; background: #444; border-radius: 0 0 7px 7px; padding: 0 7px 3px; margin-right: 5px; display: none; }
                    .clip-badge-swap-enabled { display: block; }
                    .katex .clip-badge { opacity: 0; }
                    .katex:hover .clip-badge { opacity: 1; }
                    .katex .clip-badge-copy-icon { background: #777; }
                </style>
                <div class="clip-badge">
                    <div class="clip-badge-language"></div>
                    <div class="clip-badge-swap" title="Swap view"></div>
                    <div class="clip-badge-copy-icon" title="Copy to clipboard"></div>
                </div>`;
            document.body.appendChild(node);
        }
        return node;
    }

    addAll() {
        document.querySelectorAll('.hljs, .hljs-nobg, .hljs-table, .katex').forEach(el => this.addBadge(el));
    }

    addTo(container) {
        container.querySelectorAll('.hljs, .hljs-nobg, .hljs-table, .katex').forEach(el => this.addBadge(el));
        if (container.matches('.hljs, .hljs-nobg, .hljs-table, .katex')) {
            this.addBadge(container);
        }
    }

    addBadge(el) {
        if (el.classList.contains('clip-badge-pre')) return;
        el.classList.add('clip-badge-pre');
        const badge = this.createBadgeElement(el);
        el.insertAdjacentElement('afterbegin', badge);
    }

    createBadgeElement(el) {
        const plainText = decodeURIComponent(el.dataset.plaintext || '') || el.textContent;
        let language = el.className.match(/\blanguage-(?<lang>[a-z0-9_-]+)\b/i)?.groups?.lang || 'unknown';
        let htmlText = '';
        let isSvg = false;

        if (el.classList.contains('katex')) {
            language = 'latex';
        } else if (language === 'table') {
            language = '';
            htmlText = el.innerHTML;
        } else if (language === 'svg') {
            isSvg = true;
        }

        const badge = this.settings.template.cloneNode(true);
        const langEl = badge.querySelector('.clip-badge-language');
        langEl.textContent = (language !== 'unknown' && language !== 'svg') ? language : '';
        if (el.classList.contains('hljs-message')) langEl.textContent = '';


        if (isSvg) {
            this.handleSvg(badge, el, plainText);
        }
        this.handleCopy(badge, el, plainText, htmlText);

        return badge;
    }

    handleSvg(badge, el, plainText) {
        const swapBtn = badge.querySelector('.clip-badge-swap');
        swapBtn.classList.add('clip-badge-swap-enabled');
        swapBtn.dataset.showing = 'image';
        swapBtn.innerHTML = this.settings.codeButtonContent;

        const codeBlock = el.querySelector('code');
        const highlightedCode = codeBlock.innerHTML;
        codeBlock.innerHTML = plainText; // Start by showing the rendered image

        swapBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (swapBtn.dataset.showing === 'image') {
                swapBtn.dataset.showing = 'code';
                swapBtn.innerHTML = this.settings.imageButtonContent;
                codeBlock.innerHTML = highlightedCode;
            } else {
                swapBtn.dataset.showing = 'image';
                swapBtn.innerHTML = this.settings.codeButtonContent;
                codeBlock.innerHTML = plainText;
            }
            // Re-insert the badge because innerHTML wipes it
            el.insertAdjacentElement('afterbegin', badge);
        });
    }

    handleCopy(badge, el, plainText, htmlText) {
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
                    console.error('Clipboard fallback failed', err);
                });
            }
        });
    }
}