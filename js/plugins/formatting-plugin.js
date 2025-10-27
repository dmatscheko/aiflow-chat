/**
 * @fileoverview A collection of plugins for formatting message content.
 * This file is organized into multiple small, focused plugins that are each
 * registered with the plugin manager. This modular approach allows for a clear
 * separation of concerns and makes the formatting pipeline easier to manage and extend.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { ClipBadge } from '../ui/clipbadge.js';
import math_plugin from '../3rdparty/markdown-it-katex.js';
import details_wrapper_plugin from '../ui/markdown-it-details-wrapper.js';
import { decodeHTMLEntities } from '../utils.js';

/**
 * @typedef {import('../chat-data.js').Message} Message
 * @typedef {import('../plugin-manager.js').Plugin} Plugin
 */

const clipBadge = new ClipBadge({ autoRun: false });

// --- Formatting Logic Functions ---

/**
 * Normalizes SVG content by wrapping raw SVG tags in ```svg code blocks.
 * @param {string} html - The HTML content to process.
 * @returns {string} The processed HTML.
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
 * Renders Markdown to HTML using markdown-it, with syntax highlighting and KaTeX for math.
 * @param {string} html - The HTML content to process.
 * @returns {string} The processed HTML.
 */
function markdown(html) {
    const md = window.markdownit({
        html: false,
        breaks: true,
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
    md.use(math_plugin, {
        throwOnError: false,
        errorColor: "#cc0000",
        delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\begin{equation}', right: '\\end{equation}', display: true },
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'table', 'svg', 'dma:tool_call', 'dma:tool_response', 'details'],
        preProcess: math => decodeHTMLEntities(math)
    });
    md.use(details_wrapper_plugin, {
        tags: [
            { tag: "dma:tool_call", className: "tool-call", summary: "Tool Call", attrForTitle: "name", whole: true, contentType: "html", contentWrapper: null },
            { tag: "dma:tool_response", className: "tool-response", summary: "Tool Response", attrForTitle: "name", whole: true, contentType: "html", contentWrapper: null },
            { tag: "think", className: "think", summary: "Thinking", attrForTitle: null, whole: false, contentType: "text", contentWrapper: 'div class="think-content"' },
        ],
    });
    md.validateLink = link => !['javascript:', 'dma:'].some(prefix => link.startsWith(prefix));
    return md.render(html);
}

/**
 * Adds copy-to-clipboard badges to code blocks, tables, and the entire message.
 * @param {HTMLElement} messageEl - The root message element.
 * @param {Message} message - The message object.
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
                `"${col.innerHTML.replace(/(\r\n|\n|\r|<br>)/gm,'\n').replace(/(\s\s)/gm, ' ').replace(/"/g, '""')}"`
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

    clipBadge.addTo(messageEl);
}

// --- Plugin Definitions ---

/**
 * A plugin that normalizes SVG content before Markdown rendering.
 * @type {Plugin}
 */
const svgNormalizationPlugin = {
    onPreprocessMessageContent: (html) => svgNormalization(html)
};

/**
 * A plugin that renders Markdown to HTML.
 * @type {Plugin}
 */
const markdownRenderingPlugin = {
    onRenderMessageContent: (html) => markdown(html)
};

/**
 * A plugin that performs post-processing on KaTeX DOM elements to add copyable plaintext.
 * @type {Plugin}
 */
const katexPostProcessingPlugin = {
    onPostprocessMessageContentDOM: (contentEl, message) => {
        contentEl.querySelectorAll('.katex').forEach((elem) => {
            const annotation = elem.querySelector('annotation[encoding="application/x-tex"]');
            if (annotation) {
                const latex = annotation.textContent.trim();
                elem.dataset.plaintext = encodeURIComponent(latex);
                annotation.remove();
                if (elem.parentElement.classList.contains('katex-display')) {
                    elem.classList.remove('hljs', 'language-latex', 'katex-display', 'katex');
                    const div = document.createElement('div');
                    div.classList.add('hljs', 'language-latex');
                    div.dataset.plaintext = encodeURIComponent(latex);
                    const container = elem.parentElement;
                    container.parentElement.insertBefore(div, container);
                    container.parentElement.removeChild(container);
                    div.appendChild(container);
                }
            }
        });
    }
};

/**
 * A plugin that adds copy-to-clipboard badges to the fully rendered message.
 * @type {Plugin}
 */
const clipBadgePlugin = {
    onMessageRendered: (messageEl, message) => addClipBadge(messageEl, message)
};

/**
 * The main orchestrator plugin. It constructs the entire message element,
 * runs the content through the string-based processing pipeline, injects the
 * result into a DOM element, and then triggers hooks for DOM-based post-processing.
 * @type {Plugin}
 */
const messageFramingPlugin = {
    onFormatMessage: (message) => {
        // Return the cached element if it exists, preventing re-rendering.
        if (message.cache) {
            return message.cache;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';

        const depth = message.value.role !== 'user' ? message.depth : 0;
        if (depth > 0) {
            const linesContainer = document.createElement('div');
            linesContainer.className = 'depth-lines';
            for (let i = 0; i < depth; i++) {
                const line = document.createElement('div');
                line.className = 'depth-line';
                line.style.left = `${i * 20 + 10}px`;
                linesContainer.appendChild(line);
            }
            wrapper.appendChild(linesContainer);
        }

        const el = document.createElement('div');
        el.classList.add('message', `role-${message.value.role}`);
        if (depth > 0) {
            el.style.marginLeft = `${depth * 20}px`;
        }

        const titleRow = document.createElement('div');
        titleRow.className = 'message-title';
        const titleTextEl = document.createElement('div');
        titleTextEl.className = 'message-title-text';
        const roleEl = document.createElement('strong');
        roleEl.textContent = message.value.role;
        titleTextEl.appendChild(roleEl);

        if (message.value.role === 'assistant' || message.value.role === 'tool') {
            const details = [];
            if (message.agent && pluginManager.app.agentManager) {
                const agent = pluginManager.app.agentManager.getAgent(message.agent);
                if (agent?.name) details.push(agent.name);
            }
            if (message.value.model) details.push(message.value.model);
            if (details.length > 0) {
                const detailsEl = document.createElement('span');
                detailsEl.className = 'message-details';
                detailsEl.textContent = details.join(' - ');
                titleTextEl.appendChild(detailsEl);
            }
        }
        titleRow.appendChild(titleTextEl);

        // --- Content Formatting Pipeline ---
        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';

        // 1. Start with the raw string content.
        let html = message.value.content || '';
        // 2. Run through pre-processing hooks (string in, string out).
        html = pluginManager.trigger('onPreprocessMessageContent', html);
        // 3. Run through rendering hooks (string in, string out).
        html = pluginManager.trigger('onRenderMessageContent', html);

        // 4. Set the final HTML to the element's content.
        contentEl.innerHTML = html;

        // 5. Run DOM post-processing hooks (e.g., for manipulating rendered elements like KaTeX).
        pluginManager.trigger('onPostprocessMessageContentDOM', contentEl, message);
        // --- End Pipeline ---

        el.appendChild(titleRow);
        el.appendChild(contentEl);

        // Trigger the general 'onMessageRendered' hook for things like adding UI controls.
        pluginManager.trigger('onMessageRendered', el, message);

        wrapper.appendChild(el);

        // Cache the fully constructed element.
        message.cache = wrapper;
        return wrapper;
    }
};

// Register all formatting plugins
pluginManager.register(svgNormalizationPlugin);
pluginManager.register(markdownRenderingPlugin);
pluginManager.register(katexPostProcessingPlugin);
pluginManager.register(clipBadgePlugin);
pluginManager.register(messageFramingPlugin);