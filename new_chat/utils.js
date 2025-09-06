/**
 * @fileoverview Shared utility functions.
 */

'use strict';

/**
 * Returns a function that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * `wait` milliseconds.
 * @param {Function} func The function to debounce.
 * @param {number} wait The number of milliseconds to delay.
 * @returns {(...args: any[]) => void} The new debounced function.
 */
export function debounce(func, wait) {
    /** @type {number|undefined} */
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            timeout = undefined;
            func(...args);
        };
        clearTimeout(timeout);
        timeout = window.setTimeout(later, wait);
    };
}

/**
 * @typedef {import('./main.js').Setting} Setting
 */

/**
 * Creates a DocumentFragment containing HTML elements for a given set of settings.
 * This is a recursive function that can handle nested settings and groups.
 * @param {Setting[]} settings - The settings definitions.
 * @param {Object.<string, any>} currentValues - The current values for the settings, keyed by setting ID.
 * @param {string} idPrefix - A prefix to apply to all generated element IDs to ensure uniqueness.
 * @param {string} [context] - An optional context string passed to listeners.
 * @returns {DocumentFragment} A fragment containing the rendered settings UI.
 */
export function createSettingsUI(settings, currentValues, idPrefix, context) {
    const fragment = document.createDocumentFragment();

    settings.forEach(setting => {
        const currentValue = currentValues[setting.id];
        let el;

        // Group handling (for fieldsets)
        if (setting.type === 'group') {
            const fieldset = document.createElement('fieldset');
            fieldset.id = `${idPrefix}${setting.id}`;
            if (setting.label) {
                const legend = document.createElement('legend');
                legend.textContent = setting.label;
                fieldset.appendChild(legend);
            }
            if (setting.children) {
                fieldset.appendChild(createSettingsUI(setting.children, currentValues, idPrefix, context));
            }
            el = fieldset;

        } else if (setting.type === 'button') {
            const button = document.createElement('button');
            button.id = `${idPrefix}${setting.id}`;
            button.textContent = setting.label;
            el = button;

        } else if (setting.type === 'static') {
            const staticEl = document.createElement('div');
            staticEl.classList.add('setting', 'setting-static');
            staticEl.textContent = setting.label;
            el = staticEl;

        } else { // Handle standard input types
            const settingWrapper = document.createElement('div');
            settingWrapper.classList.add('setting');

            const label = document.createElement('label');
            label.setAttribute('for', `${idPrefix}${setting.id}`);
            // label.textContent = setting.label; // Defer this for checkbox
            if (setting.type !== 'checkbox') {
                 settingWrapper.appendChild(label);
                 label.textContent = setting.label;
            }


            let input;
            const valueToSet = currentValue ?? setting.default ?? '';

            if (setting.type === 'textarea') {
                input = document.createElement('textarea');
                input.rows = setting.rows || 4;
                input.value = valueToSet;
            } else if (setting.type === 'select') {
                input = document.createElement('select');
                if (setting.options) {
                    setting.options.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = typeof opt === 'string' ? opt : opt.value;
                        option.textContent = typeof opt === 'string' ? opt : opt.label;
                        input.appendChild(option);
                    });
                }
                // If the desired value isn't in the options, add it as a "saved" option.
                let optionExists = Array.from(input.options).some(opt => opt.value === valueToSet);
                if (!optionExists && valueToSet) {
                    const savedOption = document.createElement('option');
                    savedOption.value = valueToSet;
                    savedOption.textContent = `${valueToSet} (saved)`;
                    input.appendChild(savedOption);
                }
                input.value = valueToSet;

            } else if (setting.type === 'range') {
                input = document.createElement('input');
                input.type = 'range';
                input.min = setting.min;
                input.max = setting.max;
                input.step = setting.step;
                input.value = valueToSet;

                const valueSpan = document.createElement('span');
                valueSpan.id = `${idPrefix}${setting.id}-value`;
                valueSpan.textContent = valueToSet;
                settingWrapper.appendChild(valueSpan);

                // Add a default listener to update the value span, can be overridden.
                input.addEventListener('input', () => valueSpan.textContent = input.value);

            } else if (setting.type === 'checkbox') {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = !!currentValue; // Use currentValue directly for checkbox
                // For checkboxes, the label should wrap the input
                label.appendChild(input);
                label.appendChild(document.createTextNode(' ' + setting.label));
                settingWrapper.appendChild(label);

            } else { // Default to a standard text-like input
                input = document.createElement('input');
                input.type = setting.type || 'text';
                if (setting.placeholder) input.placeholder = setting.placeholder;
                input.value = valueToSet;
            }

            input.id = `${idPrefix}${setting.id}`;
            if(setting.type !== 'checkbox') {
                settingWrapper.appendChild(input);
            }
            el = settingWrapper;
        }

        const targetElement = el.querySelector('input, select, textarea, button') || el;

        // Attach generic listeners
        if (setting.listener && targetElement) {
            for (const [event, handler] of Object.entries(setting.listener)) {
                targetElement.addEventListener(event, (e) => handler(e, el, context));
            }
        }

        fragment.appendChild(el);
    });

    return fragment;
}
