/**
 * @fileoverview A collection of plugins for formatting message content.
 * This file is organized into multiple small, focused plugins that are each
 * registered with the plugin manager. This modular approach allows for a clear
 * separation of concerns and makes the formatting pipeline easier to manage and extend.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';
import { ClipBadge } from './clipbadge.js';
import math_plugin from '../3rdparty/markdown-it-katex.js';
import details_wrapper_plugin from './markdown-it-details-wrapper.js';
import { decodeHTMLEntities } from '../utils.js';

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

// --- Core Markdown and HTML Formatting ---

/**
 * Rendering Markdown to HTML using markdown-it.
 * It also applies syntax highlighting to code blocks using highlight.js, and renders math, using katex.
 */
function markdown(html) {
    const md = window.markdownit({
        html: false,             // TODO: If possible set html to false to avoid XSS. At the moment, this breaks <br> in tables.
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
            return decodeHTMLEntities(math);
        }
    });
    md.use(details_wrapper_plugin, {
        tags: [
            {
                tag: "dma:tool_call",
                className: "tool-call",
                summary: "Tool Call",
                attrForTitle: "name",
                whole: true,
                contentType: "html",
                contentWrapper: null,
            },
            {
                tag: "dma:tool_response",
                className: "tool-response",
                summary: "Tool Response",
                attrForTitle: "name",
                whole: true,
                contentType: "html",
                contentWrapper: null,
            },
            {
                tag: "think",
                className: "think",
                summary: "Thinking",
                attrForTitle: null,
                whole: false,
                contentType: "text",
                contentWrapper: 'div class="think-content"',
            },
        ],
    });
    md.validateLink = link => !['javascript:', 'dma:'].some(prefix => link.startsWith(prefix));
    html = md.render(html);
    return html;
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


function formatMessageContent(message) {
    let messageEl;
    // Note: Caching needs invalidation (message.cache = null;) on each message modification
    if (message.cache != null) {
        messageEl = message.cache;
        return messageEl;
    } else {
        messageEl = document.createElement('div');
        messageEl.className = 'message-content';
    }


    let html = message.value.content || '';
    html = svgNormalization(html);
    html = markdown(html);

    messageEl.innerHTML = html;
    messageEl.querySelectorAll('.katex').forEach((elem) => {
        const annotation = elem.querySelector('annotation[encoding="application/x-tex"]');
        if (annotation) {
            const latex = annotation.textContent.trim();
            elem.dataset.plaintext = encodeURIComponent(latex);
            annotation.remove(); // Remove the original annotation tag
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

    message.cache = messageEl;
    return messageEl;
}

/**
 * Creates and formats an HTML element for a single message, including its
 * role, content, and depth visualization for nested agent calls.
 * @param {Message} message - The message object to format.
 * @returns {HTMLElement} The formatted message element, wrapped with depth lines if necessary.
 * @private
 */
export function formatMessage(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const depth = message.value.role !== 'user' ? message.depth : 0;

    // Add vertical lines for depth visualization.
    if (depth > 0) {
        const linesContainer = document.createElement('div');
        linesContainer.className = 'depth-lines';
        for (let i = 0; i < depth; i++) {
            const line = document.createElement('div');
            line.className = 'depth-line';
            // Offset each line so they appear as parallel lines.
            line.style.left = `${i * 20 + 10}px`;
            linesContainer.appendChild(line);
        }
        wrapper.appendChild(linesContainer);
    }

    const el = document.createElement('div');
    el.classList.add('message', `role-${message.value.role}`);

    if (depth > 0) {
        // Indent the message bubble to make space for the depth lines.
        el.style.marginLeft = `${depth * 20}px`;
    }

    const titleRow = document.createElement('div');
    titleRow.className = 'message-title';

    const titleTextEl = document.createElement('div');
    titleTextEl.className = 'message-title-text';

    const roleEl = document.createElement('strong');
    roleEl.textContent = message.value.role;
    titleTextEl.appendChild(roleEl);

    // Display agent and model details for assistant/tool messages.
    if (message.value.role === 'assistant' || message.value.role === 'tool') {
        const details = [];
    
        if (message.agent && this.agentManager) {
            const agent = this.agentManager.getAgent(message.agent);
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

    const contentEl = formatMessageContent(message);

    el.appendChild(titleRow);
    el.appendChild(contentEl);

    // Hook for adding controls (e.g., edit/delete buttons) after the message is rendered.
    pluginManager.trigger('onMessageRendered', el, message);

    addClipBadge(el, message);

    wrapper.appendChild(el);

    return wrapper;
}