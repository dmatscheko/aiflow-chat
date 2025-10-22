/**
 * @fileoverview Low-level UI element creation functions.
 * This module provides a set of helper functions for creating common HTML
 * elements in a standardized way, allowing for consistent property setting
 * and event handling.
 */

'use strict';

/**
 * A versatile, low-level function for creating any HTML element.
 * It allows setting multiple properties, attributes, styles, and event listeners
 * in a declarative way.
 *
 * @param {string} tag - The HTML tag for the element (e.g., 'div', 'button').
 * @param {object} [options={}] - An object containing properties to set on the element.
 * @param {string} [options.id] - The element's ID.
 * @param {string} [options.className] - A string of space-separated CSS classes.
 * @param {string} [options.textContent] - The text content of the element.
 * @param {object} [options.attributes] - A key-value map of attributes (e.g., `{ 'data-id': '123' }`).
 * @param {object} [options.styles] - A key-value map of CSS styles (e.g., `{ 'backgroundColor': 'red' }`).
 * @param {object} [options.events] - A key-value map of event listeners (e.g., `{ 'click': (e) => console.log('clicked') }`).
 * @param {HTMLElement[]|string[]} [options.children] - An array of child elements or strings to append.
 * @returns {HTMLElement} The newly created HTML element.
 */
export function createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.id) el.id = options.id;
    if (options.className) el.className = options.className;
    if (options.textContent) el.textContent = options.textContent;

    if (options.attributes) {
        for (const key in options.attributes) {
            el.setAttribute(key, options.attributes[key]);
        }
    }
    if (options.styles) {
        for (const key in options.styles) {
            el.style[key] = options.styles[key];
        }
    }
    if (options.events) {
        for (const key in options.events) {
            el.addEventListener(key, options.events[key]);
        }
    }
    if (options.children) {
        options.children.forEach(child => {
            el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
    }

    return el;
}

/**
 * Creates a `<button>` element.
 * @param {string} label - The text label for the button.
 * @param {object} [options={}] - Additional options passed to `createElement`.
 * @returns {HTMLButtonElement} The created button element.
 */
export function createButton(label, options = {}) {
    const defaultOptions = {
        textContent: label,
        attributes: { type: 'button' },
    };
    return createElement('button', { ...defaultOptions, ...options });
}

/**
 * Creates an `<input>` element.
 * @param {object} [options={}] - Additional options passed to `createElement`.
 *        Commonly includes `attributes: { type: 'text', placeholder: '...' }`.
 * @returns {HTMLInputElement} The created input element.
 */
export function createInput(options = {}) {
    return createElement('input', options);
}

/**
 * Creates a `<textarea>` element.
 * @param {object} [options={}] - Additional options passed to `createElement`.
 * @returns {HTMLTextAreaElement} The created textarea element.
 */
export function createTextarea(options = {}) {
    return createElement('textarea', options);
}

/**
 * Creates a `<select>` element with options.
 * @param {Array<{value: string, label: string}>} selectOptions - An array of objects for the options.
 * @param {string} [selectedValue] - The value of the option to be selected by default.
 * @param {object} [options={}] - Additional options passed to `createElement` for the `<select>` tag.
 * @returns {HTMLSelectElement} The created select element.
 */
export function createSelect(selectOptions, selectedValue, options = {}) {
    const children = selectOptions.map(opt => {
        const optionAttributes = { value: opt.value };
        if (opt.value === selectedValue) {
            optionAttributes.selected = 'selected';
        }
        return createElement('option', {
            textContent: opt.label,
            attributes: optionAttributes,
        });
    });
    return createElement('select', { ...options, children });
}
