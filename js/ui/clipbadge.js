/**
 * A heavily modified version of highlightJs Badge:
 * @see {@link https://unpkg.com/highlightjs-badge@0.1.9/highlightjs-badge.js}
 */

'use strict';

/**
 * A helper class to create and manage copy-to-clipboard badges for code blocks
 * and other elements. It is adapted from the `highlightjs-badge` library to be
 * integrated directly into the application's module system and to handle both
 * code blocks and tables.
 * @class
 */
export class ClipBadge {
    /**
     * Creates an instance of ClipBadge.
     * @param {object} [options={}] - Configuration options for the badges.
     */
    constructor(options = {}) {
        this.settings = { ...this.defaults, ...options };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    /**
     * Default settings for the ClipBadge.
     * @type {object}
     * @private
     */
    defaults = {
        templateSelector: '#clip-badge-template',
        copyIconContent: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-4H4a2 2 0 0 1-2-2V4zm8 12v4h10V10h-4v4a2 2 0 0 1-2 2h-4zm4-2V4H4v10h10z" fill="currentColor"/></svg>',
        checkIconContent: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.664 5.253a1 1 0 0 1 .083 1.411l-10.666 12a1 1 0 0 1-1.495 0l-5.333-6a1 1 0 0 1 1.494-1.328l4.586 5.159 9.92-11.16a1 1 0 0 1 1.411-.082z" fill="currentColor"/></svg>&nbsp;Copied!',
        codeButtonContent: 'Code',
        imageButtonContent: 'Image',
        autoRun: true,
    };

    /**
     * Initializes the badge system by creating and injecting the necessary styles
     * and template into the DOM.
     * @private
     */
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

    /**
     * Retrieves or creates the HTML template for the badge.
     * @returns {HTMLTemplateElement} The template element.
     * @private
     */
    getTemplate() {
        let node = document.querySelector(this.settings.templateSelector);
        if (!node) {
            node = document.createElement('template');
            node.id = 'clip-badge-template';
            node.innerHTML = `
                <style>
                    .clip-badge-pre { position: relative; }
                    .clip-badge { display: flex; flex-flow: row nowrap; align-items: flex-start; position: absolute; top: 0; right: 0; opacity: 0.4; transition: opacity 0.4s; z-index: 10; }
                    .clip-badge:hover { opacity: .7; }
                    .clip-badge-language { margin-right: 8px; margin-top: 1px; font-weight: 600; color: goldenrod; font-size: 0.85em; }
                    .clip-badge-copy-icon { cursor: pointer; padding: 3px 6px; user-select: none; background: #444; border-radius: 0 8px 0 8px; color: #fff; }
                    .clip-badge-copy-icon * { vertical-align: top; }
                    .text-success { color: limegreen !important; font-size: 0.85em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
                    .clip-badge-swap { cursor: pointer; background: #444; border-radius: 0 0 6px 6px; padding: 0 5px 2px; margin-right: 4px; display: none; font-size: 0.85em; }
                    .clip-badge-swap-enabled { display: block; }
                    .katex .clip-badge { opacity: 0; }
                    .katex:hover .clip-badge { opacity: .7; }
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

    /**
     * Finds all `pre.hljs` elements on the page and adds a badge to each.
     * (Not used in the current implementation, but kept for completeness).
     */
    addAll() {
        document.querySelectorAll('.hljs, .hljs-nobg, .hljs-table, .katex').forEach(el => this.addBadge(el));
    }

    /**
     * Adds badges to all valid target elements within a given container.
     * @param {HTMLElement} container - The container element to search within.
     */
    addTo(container) {
        container.querySelectorAll('.hljs, .hljs-nobg, .hljs-table, .katex').forEach(el => this.addBadge(el));
        if (container.matches('.hljs, .hljs-nobg, .hljs-table, .katex')) {
            this.addBadge(container);
        }
    }

    /**
     * Adds a single copy badge to a specified element.
     * @param {HTMLElement} highlightEl - The element to add the badge to.
     * @private
     */
    addBadge(el) {
        if (el.classList.contains('clip-badge-pre')) return;
        el.classList.add('clip-badge-pre');
        const badge = this.createBadgeElement(el);
        el.insertAdjacentElement('afterbegin', badge);
    }

    /**
     * Creates the badge DOM element and sets up its click event listener for copying.
     * @param {HTMLElement} highlightEl - The element the badge will be associated with.
     * @returns {HTMLElement} The created badge element.
     * @private
     */
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
