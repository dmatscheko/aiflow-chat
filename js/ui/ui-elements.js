/**
 * @fileoverview Provides low-level factory functions for creating common UI elements
 * in a standardized and generic way. This module centralizes element creation,
 * allowing for consistent application of classes, properties, and event listeners.
 */

'use strict';

/**
 * A versatile factory function for creating any HTML element.
 * @param {string} tag - The HTML tag for the element (e.g., 'div', 'button').
 * @param {object} [props={}] - An object of properties to apply to the element.
 *   Special properties handled:
 *   - `className`: Sets the element's class.
 *   - `textContent`: Sets the element's text content.
 *   - `innerHTML`: Sets the element's inner HTML.
 *   - `children`: An array of child elements to append.
 *   - `dataset`: An object of data attributes (e.g., { id: '123' } becomes `data-id="123"`).
 *   - `on<Event>`: Event listeners (e.g., `onClick`).
 *   - Other properties are set directly on the element if they exist (e.g., `value`, `checked`),
 *     otherwise they are set as attributes.
 * @returns {HTMLElement} The created HTML element.
 */
export function createElement(tag, props = {}) {
    const el = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null) continue;

        if (key.startsWith('on') && typeof value === 'function') {
            el.addEventListener(key.substring(2).toLowerCase(), value);
        } else if (key === 'children' && Array.isArray(value)) {
            value.forEach(child => child && el.appendChild(child));
        } else if (key === 'dataset' && typeof value === 'object') {
            Object.assign(el.dataset, value);
        } else {
            // Check if the property exists on the element prototype. If so, set it directly.
            // This is better for boolean attributes like 'checked' or 'disabled'.
            if (key in el) {
                try {
                    el[key] = value;
                } catch (e) {
                    // Fallback for read-only properties or other errors
                    el.setAttribute(key, value);
                }
            } else {
                el.setAttribute(key, value);
            }
        }
    }
    return el;
}

/**
 * Creates a button element.
 * @param {string} label - The text label for the button.
 * @param {object} [options={}] - Additional properties for the button.
 * @returns {HTMLButtonElement}
 */
export function createButton(label, options = {}) {
    return createElement('button', { textContent: label, ...options });
}

/**
 * Creates an input element.
 * @param {object} [options={}] - Properties for the input (e.g., { type, placeholder, value }).
 * @returns {HTMLInputElement}
 */
export function createInput(options = {}) {
    return createElement('input', options);
}

/**
 * Creates a select (dropdown) element.
 * @param {Array<{value: string, label: string, selected?: boolean}>} optionsData - Data for the <option> elements.
 * @param {string} [selectedValue] - The value that should be pre-selected.
 * @param {object} [props={}] - Additional properties for the select element.
 * @returns {HTMLSelectElement}
 */
export function createSelect(optionsData, selectedValue, props = {}) {
    const children = (optionsData || []).map(opt => {
        const optionProps = {
            value: opt.value,
            textContent: opt.label,
        };
        // The `selectedValue` parameter takes precedence for determining selection.
        if (selectedValue !== undefined && opt.value === selectedValue) {
            optionProps.selected = true;
        } else if (opt.selected) {
            optionProps.selected = true;
        }
        return createElement('option', optionProps);
    });

    return createElement('select', { children, ...props });
}

/**
 * Creates a textarea element.
 * @param {object} [options={}] - Properties for the textarea.
 * @returns {HTMLTextAreaElement}
 */
export function createTextarea(options = {}) {
    return createElement('textarea', options);
}
