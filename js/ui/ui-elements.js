/**
 * @fileoverview A library of functions for creating common UI elements.
 * This module centralizes the creation of standard UI components like buttons,
 * inputs, and select dropdowns to ensure consistency across the application.
 */

'use strict';

/**
 * Creates a standard button element.
 * @param {object} options - The configuration for the button.
 * @param {string} options.id - The ID for the button element.
 * @param {string} options.label - The text label for the button.
 * @param {string} [options.className] - Optional CSS class for styling.
 * @param {function(MouseEvent): void} options.onClick - The click event handler.
 * @returns {HTMLButtonElement} The created button element.
 */
export function createButton({ id, label, className, onClick }) {
    const button = document.createElement('button');
    button.id = id;
    button.textContent = label;
    if (className) {
        button.className = className;
    }
    button.addEventListener('click', onClick);
    return button;
}

/**
 * Creates a standard text input element.
 * @param {object} options - The configuration for the input.
 * @param {string} options.id - The ID for the input element.
 * @param {string} [options.className] - Optional CSS class for styling.
 * @param {string} [options.placeholder] - Placeholder text for the input.
 * @param {string} [options.value] - The initial value of the input.
 * @returns {HTMLInputElement} The created input element.
 */
export function createInput({ id, className, placeholder, value, type = 'text', checked }) {
    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    if (className) {
        input.className = className;
    }
    if (placeholder) {
        input.placeholder = placeholder;
    }
    if (value) {
        input.value = value;
    }
    if (type === 'checkbox' && checked) {
        input.checked = checked;
    }
    return input;
}

/**
 * Creates a standard textarea element.
 * @param {object} options - The configuration for the textarea.
 * @param {string} options.id - The ID for the textarea element.
 * @param {string} [options.className] - Optional CSS class for styling.
 * @param {string} [options.placeholder] - Placeholder text for the textarea.
 * @param {string} [options.value] - The initial value of the textarea.
 * @param {number} [options.rows] - The number of rows for the textarea.
 * @returns {HTMLTextAreaElement} The created textarea element.
 */
export function createTextarea({ id, className, placeholder, value, rows }) {
    const textarea = document.createElement('textarea');
    textarea.id = id;
    if (className) {
        textarea.className = className;
    }
    if (placeholder) {
        textarea.placeholder = placeholder;
    }
    if (value) {
        textarea.value = value;
    }
    if (rows) {
        textarea.rows = rows;
    }
    return textarea;
}

/**
 * Creates a standard select (dropdown) element.
 * @param {object} options - The configuration for the select element.
 * @param {string} options.id - The ID for the select element.
 * @param {string} [options.className] - Optional CSS class for styling.
 * @param {Array<{value: string, label: string}>} options.options - An array of option objects.
 * @param {string} [options.selectedValue] - The value of the option to be selected by default.
 * @returns {HTMLSelectElement} The created select element.
 */
export function createSelect({ id, className, options, selectedValue }) {
    const select = document.createElement('select');
    select.id = id;
    if (className) {
        select.className = className;
    }
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === selectedValue) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    return select;
}