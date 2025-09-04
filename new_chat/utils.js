/**
 * @fileoverview Shared utility functions.
 */

'use strict';

/**
 * Returns a function, that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * N milliseconds.
 * @param {Function} func The function to debounce.
 * @param {number} wait The number of milliseconds to wait.
 * @returns {Function} The debounced function.
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Creates HTML elements for a given set of settings.
 * @param {object[]} settings - The settings definitions.
 * @param {object} currentValues - The current values for the settings.
 * @param {string} idPrefix - A prefix for the element IDs.
 * @returns {DocumentFragment} A fragment containing the rendered settings.
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
        input.value = currentValue ?? setting.default ?? '';
        el.appendChild(input);

        fragment.appendChild(el);
    });

    return fragment;
}

/**
 * Creates HTML elements for tool settings.
 * @param {object[]} tools - The list of available tools.
 * @param {object} currentSettings - The current tool settings { allowed: string[], allowAll: boolean }.
 * @param {function(object): void} onChange - Callback function when settings change.
 * @returns {HTMLElement} A fieldset element containing the tool settings UI.
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
