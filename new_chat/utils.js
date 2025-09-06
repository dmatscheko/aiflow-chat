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
 * @param {Setting[]} settings - The settings definitions.
 * @param {Object.<string, any>} currentValues - The current values for the settings, keyed by setting ID.
 * @param {string} idPrefix - A prefix to apply to all generated element IDs to ensure uniqueness.
 * @returns {DocumentFragment} A fragment containing the rendered settings UI.
 */
export function createSettingsUI(settings, currentValues, idPrefix) {
    const fragment = document.createDocumentFragment();

    settings.forEach(setting => {
        const el = document.createElement('div');
        el.classList.add('setting');

        const label = document.createElement('label');
        label.setAttribute('for', `${idPrefix}${setting.id}`);
        label.textContent = setting.label;
        el.appendChild(label);

        let input;
        const currentValue = currentValues[setting.id];

        if (setting.type === 'textarea') {
            input = document.createElement('textarea');
            input.rows = 4;
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
        } else if (setting.type === 'range') {
            input = document.createElement('input');
            input.type = 'range';
            input.min = setting.min;
            input.max = setting.max;
            input.step = setting.step;

            const valueSpan = document.createElement('span');
            valueSpan.id = `${idPrefix}${setting.id}-value`;
            valueSpan.textContent = currentValue ?? setting.default;
            el.appendChild(valueSpan);

            input.addEventListener('input', () => {
                valueSpan.textContent = input.value;
            });
        } else {
            input = document.createElement('input');
            input.type = setting.type || 'text';
            if (setting.placeholder) input.placeholder = setting.placeholder;
        }

        input.id = `${idPrefix}${setting.id}`;
        const valueToSet = currentValue ?? setting.default ?? '';

        if (setting.type === 'select') {
            // For select, we need to find the matching option and set its `selected` property.
            // This is because setting `input.value` on a select element before it's in the DOM
            // doesn't guarantee the correct option will be displayed.
            const optionToSelect = Array.from(input.options).find(opt => opt.value === valueToSet);
            if (optionToSelect) {
                optionToSelect.selected = true;
            }
        } else {
            // For other input types, setting the value attribute is more reliable
            // for serialization than setting the .value property.
            input.setAttribute('value', valueToSet);
        }

        el.appendChild(input);

        fragment.appendChild(el);
    });

    return fragment;
}

/**
 * @typedef {import('./tool-processor.js').ToolSchema} ToolSchema
 */

/**
 * @typedef {object} ToolSettings
 * @property {boolean} allowAll - Whether to allow all tools.
 * @property {string[]} allowed - A list of allowed tool names if allowAll is false.
 */

/**
 * @callback OnToolSettingsChange
 * @param {ToolSettings} newSettings - The updated tool settings.
 */

/**
 * Creates an HTML fieldset element for managing tool permissions.
 * @param {ToolSchema[]} tools - The list of available tools.
 * @param {ToolSettings} currentSettings - The current tool settings.
 * @param {OnToolSettingsChange} onChange - Callback function triggered when settings change.
 * @returns {HTMLFieldSetElement} A fieldset element containing the tool settings UI.
 */
export function createToolSettingsUI(tools, currentSettings, onChange) {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Tool Settings';
    fieldset.appendChild(legend);

    const allowAllContainer = document.createElement('div');
    allowAllContainer.classList.add('form-group');

    const allowAllLabel = document.createElement('label');
    allowAllLabel.classList.add('checkbox-label');

    const allowAllCheckbox = document.createElement('input');
    allowAllCheckbox.type = 'checkbox';
    allowAllCheckbox.checked = currentSettings.allowAll;

    const toolListContainer = document.createElement('div');
    toolListContainer.style.display = currentSettings.allowAll ? 'none' : 'block';

    allowAllLabel.appendChild(allowAllCheckbox);
    allowAllLabel.appendChild(document.createTextNode(' Allow all tools'));
    allowAllContainer.appendChild(allowAllLabel);
    fieldset.appendChild(allowAllContainer);
    fieldset.appendChild(toolListContainer);

    const allowedSet = new Set(currentSettings.allowed);

    tools.forEach(tool => {
        const toolContainer = document.createElement('div');
        const toolLabel = document.createElement('label');
        toolLabel.classList.add('checkbox-label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = tool.name;
        checkbox.checked = allowedSet.has(tool.name);

        toolLabel.appendChild(checkbox);
        toolLabel.appendChild(document.createTextNode(` ${tool.name}`));
        toolContainer.appendChild(toolLabel);
        toolListContainer.appendChild(toolContainer);
    });

    const getSettings = () => {
        const allowed = Array.from(toolListContainer.querySelectorAll('input:checked')).map(cb => cb.value);
        return {
            allowAll: allowAllCheckbox.checked,
            allowed,
        };
    };

    allowAllCheckbox.addEventListener('change', () => {
        toolListContainer.style.display = allowAllCheckbox.checked ? 'none' : 'block';
        onChange(getSettings());
    });

    fieldset.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox' && e.target !== allowAllCheckbox) {
            onChange(getSettings());
        }
    });

    return fieldset;
}
