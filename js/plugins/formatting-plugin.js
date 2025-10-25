/**
 * @fileoverview A collection of plugins for formatting message content.
 * This file is organized into multiple small, focused plugins that are each
 * registered with the plugin manager. This modular approach allows for a clear
 * separation of concerns and makes the formatting pipeline easier to manage and extend.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { ClipBadge } from '../ui/clipbadge.js';

/**
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../plugin-manager.js').Plugin} Plugin
 */

const clipBadge = new ClipBadge({ autoRun: false });

// --- Pre-Markdown Formatting Plugins ---

/**
 * Normalizing SVG content before Markdown rendering.
 * It wraps raw SVG tags in ```svg code blocks and ensures data URIs are well-formed.
 */
function svgNormalization(html) {
    html = html.replace(/((?:```\w*?\s*?)|(?:<render_component[^>]*?>\s*?)|)(<svg[^>]*?>)([\s\S]*?)(<\/svg>(?:\s*?```|\s*?<\/render_component>|)|$)/gi,
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
    html = html.replace(/\(data:image\/svg\+xml,([a-z0-9_"'%+-]+?)\)/gmi, (match, g1) => {
        let data = decodeURIComponent(g1);
        data = data.replace(/<svg\s/gmi, '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ');
        return `(data:image/svg+xml,${encodeURIComponent(data)})`;
    });
    return html;
}

/**
 * Wrapping tool calls and responses in special placeholder tags.
 * This protects them from the Markdown renderer so they can be converted into
 * <details> blocks later in the pipeline.
 */
function preDetailsWrapper(html) {
    html = html.replace(/<dma:tool_call[^>]+?name="([^>]*?)"[^>]*?(?:\/>|>[\s\S]*?<\/dma:tool_call>)/gi, (match, name) => {
        const open = match.endsWith('</dma:tool_call>') ? '' : ' open';
        const title = name || '';
        return `\n-#--#- TOOL CALL${open} -#--#- ${title.trim()} -#--#-\n\`\`\`html\n${match.trim()}\n\`\`\`\n-#--#- END TOOL CALL -#--#-\n`;
    });
    html = html.replace(/<dma:tool_response[^>]+?name="([^>]*?)"[^>]*?(?:\/>|>[\s\S]*?<\/dma:tool_response>)/gi, (match, name) => {
        const open = match.endsWith('</dma:tool_response>') ? '' : ' open';
        const title = name || '';
        return `\n-#--#- TOOL RESPONSE${open} -#--#- ${title.trim()} -#--#-\n\`\`\`html\n${match.trim()}\n\`\`\`\n-#--#- END TOOL RESPONSE -#--#-\n`;
    });
    html = html.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, (match, content) => {
        const open = match.endsWith('</think>') ? '' : ' open';
        return `\n-#--#- THINK${open} -#--#-\n${content.trim()}\n-#--#- END THINK -#--#-\n`;
    });
    return html;
}

// --- Core Markdown and HTML Formatting ---

/**
 * Rendering Markdown to HTML using markdown-it.
 * It also applies syntax highlighting to code blocks using highlight.js.
 */
function markdown(html) {
    const md = window.markdownit({
        html: false,             // TODO: If possible set html to false to avoid XSS. At the moment, this breaks <br> in tables.
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
    // text = text.replaceAll(/<br>/g,"\n");
    return md.render(html);
}

/**
 * Converting the placeholder tags for tool calls/responses and thinking
 * blocks into collapsible <details> HTML elements.
 */
function detailsWrapper(html) {
    html = html.replace(/-#--#- TOOL CALL((?: open)?) -#--#- (.*?) -#--#-<\/p>([\s\S]*?)<p>-#--#- END TOOL CALL -#--#-/g, (match, open, name, content) => {
        const title = name ? ': ' + name : '';
        return `<details${open} class="tool-call"><summary>Tool Call${title}</summary>${content}</details>`;
    });
    html = html.replace(/-#--#- TOOL RESPONSE((?: open)?) -#--#- (.*?) -#--#-<\/p>([\s\S]*?)<p>-#--#- END TOOL RESPONSE -#--#-/g, (match, open, name, content) => {
        const title = name ? ': ' + name : '';
        return `<details${open} class="tool-response"><summary>Tool Response${title}</summary>${content}</details>`;
    });
    html = html.replace(/-#--#- THINK((?: open)?) -#--#-<\/p>([\s\S]*?)<p>-#--#- END THINK -#--#-/g, (match, open, content) => {
        return `<details${open} class="think"><summary>Thinking</summary><div class="think-content">${content}</div></details>`;
    });
    return html;
}

// --- Post-HTML Formatting and UI Enhancements ---

/**
 * Rendering LaTeX mathematics using KaTeX.
 * It also ensures that the original LaTeX source is preserved for copying.
 */
function katex(contentEl) {
    const origFormulas = [];
    renderMathInElement(contentEl, {
        delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            // { left: '\\(', right: '\\)', display: false },
            // { left: '\\[', right: '\\]', display: true },
            { left: '\\begin{equation}', right: '\\end{equation}', display: true },
            // { left: '\\begin{align}', right: '\\end{align}', display: true },
            // { left: '\\begin{alignat}', right: '\\end{alignat}', display: true },
            // { left: '\\begin{gather}', right: '\\end{gather}', display: true },
            // { left: '\\begin{CD}', right: '\\end{CD}', display: true }
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'table', 'svg', 'dma:tool_call', 'dma:tool_response', 'details'],
        throwOnError: false,
        preProcess: math => {
            origFormulas.push(math);
            return math;
        }
    });
    contentEl.querySelectorAll('.katex').forEach((elem, i) => {
        if (i >= origFormulas.length) return;
        if (elem.parentElement.classList.contains('katex-display')) {
            const div = document.createElement('div');
            div.classList.add('hljs', 'language-latex');
            div.dataset.plaintext = encodeURIComponent(origFormulas[i].trim());

            const container = elem.parentElement;
            container.parentElement.insertBefore(div, container);
            container.parentElement.removeChild(container);
            div.appendChild(container);
        }
    });
    return contentEl;
}

/**
 * Adding copy-to-clipboard badges to various elements like
 * code blocks, tables, and the entire message.
 */
function addClipBadge(messageEl, message) {
    messageEl.classList.add('hljs-nobg', 'hljs-message');
    const contentToCopy = message.value.content || '';
    messageEl.dataset.plaintext = encodeURIComponent(contentToCopy.trim());

    const tableToCSV = (table) => {
        const separator = ';';
        const rows = table.querySelectorAll('tr');
        return Array.from(rows).map(row =>
            Array.from(row.querySelectorAll('td, th')).map(col =>
                `"${col.innerHTML.replace(/(\r\n|\n|\r|<br>)/gm, '\n').replace(/(\s\s)/gm, ' ').replace(/"/g, '""')}"`
            ).join(separator)
        ).join('\n');
    };

    messageEl.querySelectorAll('table').forEach(table => {
        const div = document.createElement('div');
        div.classList.add('hljs-nobg', 'hljs-table', 'language-table');
        div.dataset.plaintext = encodeURIComponent(tableToCSV(table));
        table.parentElement.insertBefore(div, table);
        table.parentElement.removeChild(table);
        div.appendChild(table);
    });

    clipBadge.addTo(messageEl);
}

// Combined plugin that internally calls all individual plugin functions in sequence.
// The order is preserved to maintain the original pipeline.
const combinedFormattingPlugin = {
    onFormatMessageContent(contentEl, message) {
        // Note: Caching needs invalidation (message.cache = null;) on each message modification
        if (message.cache != null) {
            contentEl.innerHTML = message.cache;
            return contentEl;
        }

        let html = contentEl.innerHTML || '';

        html = svgNormalization(html);
        html = preDetailsWrapper(html);
        html = markdown(html);
        html = detailsWrapper(html);
        contentEl.innerHTML = html;
        contentEl = katex(contentEl);

        message.cache = contentEl.innerHTML;
        return contentEl;
    },
    onMessageRendered(messageEl, message) {
        addClipBadge(messageEl, message);
    }
};

// Register the combined plugin with the plugin manager.
pluginManager.register(combinedFormattingPlugin);
