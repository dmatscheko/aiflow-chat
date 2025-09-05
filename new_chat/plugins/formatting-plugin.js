/**
 * @fileoverview A plugin for formatting message content, such as wrapping tool calls in <details> tags.
 */

'use strict';

import { pluginManager } from '../plugin-manager.js';

/**
 * @typedef {import('../chat-data.js').Message} Message
 */

/**
 * A plugin that formats tool calls and responses into collapsible `<details>` elements.
 * It uses a two-pass system:
 * 1. `onFormatMessageContent`: Runs before Markdown processing. It finds tool-related
 *    XML tags and wraps them in unique placeholders and a ` ```html ` code block.
 *    This ensures the XML is treated as literal text by the Markdown parser.
 * 2. `onPostFormatMessageContent`: Runs after Markdown processing. It finds the
 *    HTML generated from the placeholders and replaces it with the final `<details>`
 *    element structure.
 *
 * @type {import('../plugin-manager.js').Plugin}
 */
const formattingPlugin = {
    name: 'detailsWrapper',
    hooks: {
        /**
         * Wraps tool calls and responses in special placeholder tags.
         * This runs before Markdown rendering.
         * @param {string} content - The text content to format.
         * @returns {string} The formatted text.
         */
        onFormatMessageContent(content) {
            let text = content;
            // Wrap tool calls in special tags
            text = text.replace(/<dma:tool_call[^>]+?name="([^>]*?)"[^>]*?(?:\/>|>[\s\S]*?<\/dma:tool_call\s*>)/gi, (match, name) => {
                const title = name ? name : '';
                return `\n-#--#- TOOL CALL -#--#- ${title.trim()} -#--#-\n\`\`\`html\n${match.trim()}\n\`\`\`\n-#--#- END TOOL CALL -#--#-\n`;
            });
            // Wrap tool responses in special tags
            text = text.replace(/<dma:tool_response[^>]+?name="([^>]*?)"[^>]*?(?:\/>|>[\s\S]*?<\/dma:tool_response\s*>)/gi, (match, name) => {
                const title = name ? name : '';
                return `\n-#--#- TOOL RESPONSE -#--#- ${title.trim()} -#--#-\n\`\`\`html\n${match.trim()}\n\`\`\`\n-#--#- END TOOL RESPONSE -#--#-\n`;
            });
            return text;
        },

        /**
         * Replaces the placeholder tags with actual <details> elements.
         * This runs after Markdown rendering.
         * @param {HTMLElement} contentEl - The HTML element containing the formatted content.
         */
        onPostFormatMessageContent(contentEl) {
            let html = contentEl.innerHTML;
            const open = ' open'; // Decide if details should be open by default, maybe based on message position later

            // Wrap tool calls in <details>
            html = html.replace(/-#--#- TOOL CALL -#--#- (.*?) -#--#-<\/p>([\s\S]*?)<p>-#--#- END TOOL CALL -#--#-/g, (match, name, content) => {
                const title = name ? ': ' + name : '';
                return `<details${open} class="tool-call"><summary>Tool Call${title}</summary>${content}</details>`;
            });
            // Wrap tool responses in <details>
            html = html.replace(/-#--#- TOOL RESPONSE -#--#- (.*?) -#--#-<\/p>([\s\S]*?)<p>-#--#- END TOOL RESPONSE -#--#-/g, (match, name, content) => {
                const title = name ? ': ' + name : '';
                return `<details${open} class="tool-response"><summary>Tool Response${title}</summary>${content}</details>`;
            });

            contentEl.innerHTML = html;
        }
    }
};

pluginManager.register(formattingPlugin);
