/**
 * @fileoverview Message formatting pipeline: Markdown rendering, syntax highlighting,
 * SVG normalization, KaTeX math, and copy-to-clipboard badge injection.
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

// --- Pre-Markdown Formatting ---

/**
 * Normalizes SVG content before Markdown rendering.
 * Wraps raw SVG tags in fenced code blocks and ensures data URIs are well-formed.
 * @param {string} html - The raw message content.
 * @returns {string} The content with SVGs wrapped in code blocks.
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
 * Lazily initialized, reusable markdown-it instance.
 * The instance is stateless between renders, so it can safely be shared.
 * @type {object | null}
 */
let mdInstance = null;

/**
 * Returns the shared markdown-it instance, creating it on first call.
 * @returns {object} The configured markdown-it instance.
 */
function getMarkdownIt() {
    if (mdInstance) return mdInstance;

    mdInstance = window.markdownit({
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
    mdInstance.use(math_plugin, {
        throwOnError: false,
        errorColor: "#cc0000",
        delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\begin{equation}', right: '\\end{equation}', display: true },
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'table', 'svg', 'dma:tool_call', 'dma:tool_response', 'details'],
        preProcess: math => {
            return decodeHTMLEntities(math);
        }
    });
    mdInstance.use(details_wrapper_plugin, {
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
    mdInstance.validateLink = link => !['javascript:', 'dma:'].some(prefix => link.startsWith(prefix));
    return mdInstance;
}

/**
 * Renders Markdown to HTML using the shared markdown-it instance.
 * Applies syntax highlighting (highlight.js) and math rendering (KaTeX).
 * @param {string} html - The Markdown content to render.
 * @returns {string} The rendered HTML.
 */
function markdown(html) {
    return getMarkdownIt().render(html);
}

/**
 * Adds copy-to-clipboard badges to code blocks, tables, and the full message.
 * Tables are wrapped in a container and their content converted to CSV for copying.
 * @param {HTMLElement} messageEl - The message's root DOM element.
 * @param {Message} message - The message data object.
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
        // Skip tables already wrapped by a previous addClipBadge call.
        if (table.parentElement?.classList.contains('hljs-table')) return;
        const div = document.createElement('div');
        div.classList.add('hljs-nobg', 'hljs-table', 'language-table');
        div.dataset.plaintext = encodeURIComponent(tableToCSV(table));
        table.parentElement.insertBefore(div, table);
        table.parentElement.removeChild(table);
        div.appendChild(table);
    });

    clipBadge.addTo(messageEl);
}


/**
 * Renders the full formatting pipeline (SVG normalization, Markdown, KaTeX) and
 * returns the resulting HTML string along with the processed DOM element.
 * @param {string} rawContent - The raw message content.
 * @returns {HTMLElement} A temporary element containing the rendered content.
 */
function renderContentToElement(rawContent) {
    let html = rawContent || '';
    html = svgNormalization(html);
    html = markdown(html);

    const el = document.createElement('div');
    el.innerHTML = html;
    processKatex(el);
    return el;
}

/**
 * Post-processes KaTeX elements in a container: extracts LaTeX source for copy badges
 * and wraps display-math elements in a container div.
 * @param {HTMLElement} container - The DOM element to process.
 */
function processKatex(container) {
    container.querySelectorAll('.katex').forEach((elem) => {
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
                const katexContainer = elem.parentElement;
                katexContainer.parentElement.insertBefore(div, katexContainer);
                katexContainer.parentElement.removeChild(katexContainer);
                div.appendChild(katexContainer);
            }
        }
    });
}

/**
 * Renders a message's content through the full formatting pipeline (SVG normalization,
 * Markdown, KaTeX) and returns a cached DOM element. Returns the cached element on
 * subsequent calls unless `message.cache` has been cleared.
 * @param {Message} message - The message to format.
 * @returns {HTMLElement} The formatted content element.
 */
function formatMessageContent(message) {
    // Note: Caching needs invalidation (message.cache = null;) on each message modification
    if (message.cache != null) {
        return message.cache;
    }

    const messageEl = document.createElement('div');
    messageEl.className = 'message-content';

    const rendered = renderContentToElement(message.value.content);
    messageEl.innerHTML = rendered.innerHTML;

    message.cache = messageEl;
    return messageEl;
}

/**
 * Updates an existing message-content element incrementally by performing a block-level
 * DOM diff. Unchanged leading block elements are left untouched (preserving text selection),
 * and only the first divergent element and everything after it are replaced/appended.
 * @param {HTMLElement} existingContentEl - The existing `.message-content` DOM element.
 * @param {Message} message - The message with updated content.
 */
export function updateContentElement(existingContentEl, message) {
    const rendered = renderContentToElement(message.value.content);
    const newChildren = Array.from(rendered.children);
    const oldChildren = Array.from(existingContentEl.children);

    // Find the first divergent block-level child.
    let matchCount = 0;
    const minLen = Math.min(oldChildren.length, newChildren.length);
    for (let i = 0; i < minLen; i++) {
        if (oldChildren[i].outerHTML === newChildren[i].outerHTML) {
            matchCount++;
        } else {
            break;
        }
    }

    // Remove old children from the divergence point onward.
    for (let j = oldChildren.length - 1; j >= matchCount; j--) {
        existingContentEl.removeChild(oldChildren[j]);
    }

    // Append new/changed children from the divergence point onward.
    for (let j = matchCount; j < newChildren.length; j++) {
        existingContentEl.appendChild(newChildren[j]);
    }

    message.cache = existingContentEl;
}

/**
 * Creates and formats an HTML element for a single message, including its
 * role, content, and depth visualization for nested agent calls.
 * @param {Message} message - The message object to format.
 * @returns {HTMLElement} The formatted message element, wrapped with depth lines if necessary.
 * @private
 */
export { addClipBadge };

export function formatMessage(message) {
    // Log messages are display-only: render as simple text between chat bubbles,
    // not inside a bubble, to signal they are not part of the AI conversation.
    if (message.value.role === 'log') {
        const logEl = document.createElement('div');
        logEl.className = 'log-message';
        logEl.textContent = message.value.content || '';
        return logEl;
    }

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
    // For 'tool' role messages, only show agent details when a model is set,
    // which indicates an AI-generated sub-agent response. System-generated
    // tool responses (e.g., MCP tool results) have no model and should not
    // display an agent header, as they are not authored by any agent.
    if (message.value.role === 'assistant' || message.value.role === 'tool') {
        const details = [];
        const showAgentForTool = message.value.role !== 'tool' || !!message.value.model;

        const agentManager = pluginManager.app?.agentManager;
        if (showAgentForTool && message.agent && agentManager) {
            const agent = agentManager.getAgent(message.agent);
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
