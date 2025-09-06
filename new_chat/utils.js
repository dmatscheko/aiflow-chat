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
 * @callback SettingListener
 * @param {Event} event - The event that triggered the listener.
 * @param {HTMLElement} element - The UI element the listener is attached to.
 * @param {string} context - The context in which the settings are being rendered (e.g., 'main', 'agent').
 */

/**
 * @typedef {object} Setting
 * @property {string} id - The unique identifier for the setting.
 * @property {string} label - The display label for the setting.
 * @property {string} type - The input type (e.g., 'text', 'select', 'checkbox', 'checkbox-list', 'button').
 * @property {*} [default] - The default value for the setting.
 * @property {Array<string|{value: string, label: string}>} [options] - Options for 'select' or 'checkbox-list' types.
 * @property {string} [placeholder] - Placeholder text for input fields.
 * @property {number} [min] - Minimum value for range inputs.
 * @property {number} [max] - Maximum value for range inputs.
 * @property {number} [step] - Step value for range inputs.
 * @property {Object.<string, SettingListener>} [listeners] - A map of event types to listener functions.
 * @property {Setting[]} [children] - Child settings for creating nested structures, like a list of checkboxes.
 * @property {string} [className] - A custom CSS class to add to the setting's container element.
 */

/**
 * @typedef {object} SettingAction
 * @property {string} id - The unique identifier for the button.
 * @property {string} label - The display text for the button.
 * @property {(e: MouseEvent, el: HTMLElement, context: string) => void} onClick - The function to call when the button is clicked.
 */

/**
 * Creates a DocumentFragment containing HTML elements for a given set of settings.
 * @param {Setting[]} settings - The settings definitions.
 * @param {Object.<string, any>} currentValues - The current values for the settings, keyed by setting ID.
 * @param {string} idPrefix - A prefix to apply to all generated element IDs to ensure uniqueness.
 * @param {string} context - A string identifying the context (e.g., 'main_settings', 'agent_settings').
 * @param {Object.<string, SettingAction[]>} [actions={}] - An object mapping setting IDs to an array of action buttons.
 * @returns {DocumentFragment} A fragment containing the rendered settings UI.
 */
export function createSettingsUI(settings, currentValues, idPrefix, context, actions = {}) {
    const fragment = document.createDocumentFragment();

    settings.forEach(setting => {
        const el = document.createElement('div');
        el.classList.add('setting');
        if (setting.className) {
            el.classList.add(setting.className);
        }

        let label;
        let input;
        const currentValue = currentValues[setting.id];
        const valueToSet = currentValue ?? setting.default ?? '';

        // Create label element - for most types, it's separate.
        // For checkbox, the input is inside the label.
        if (setting.label && setting.type !== 'checkbox') {
            label = document.createElement('label');
            label.setAttribute('for', `${idPrefix}${setting.id}`);
            label.textContent = setting.label;
            el.appendChild(label);
        }

        // --- Create Input Element based on Type ---
        switch (setting.type) {
            case 'textarea':
                input = document.createElement('textarea');
                input.rows = 4;
                input.value = valueToSet;
                break;

            case 'select':
                input = document.createElement('select');
                if (setting.options) {
                    setting.options.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = typeof opt === 'string' ? opt : opt.value;
                        option.textContent = typeof opt === 'string' ? opt : opt.label;
                        input.appendChild(option);
                    });
                }
                break;

            case 'range':
                input = document.createElement('input');
                input.type = 'range';
                input.min = setting.min;
                input.max = setting.max;
                input.step = setting.step;
                input.value = valueToSet;
                const valueSpan = document.createElement('span');
                valueSpan.id = `${idPrefix}${setting.id}-value`;
                valueSpan.textContent = valueToSet;
                el.appendChild(valueSpan);
                // Add a default listener to update the value span, can be overridden.
                if (!setting.listeners?.input) {
                    input.addEventListener('input', () => valueSpan.textContent = input.value);
                }
                break;

            case 'checkbox':
                label = document.createElement('label');
                label.className = 'checkbox-label';
                input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = !!valueToSet;
                label.appendChild(input);
                label.appendChild(document.createTextNode(` ${setting.label}`));
                // The label element is the main container for checkbox
                el.appendChild(label);
                break;

            case 'checkbox-list':
                const container = document.createElement('div');
                container.id = `${idPrefix}${setting.id}`;
                container.classList.add('checkbox-list-container');
                if (setting.children) {
                    // Get the values for the children checkboxes
                    const childValues = valueToSet.allowed || [];
                    const childCurrentValues = {};
                    setting.children.forEach(child => {
                        childCurrentValues[child.id] = childValues.includes(child.id);
                    });
                    const childFragment = createSettingsUI(setting.children, childCurrentValues, idPrefix, context);
                    container.appendChild(childFragment);
                }
                el.appendChild(container);
                break;

            case 'button':
                input = document.createElement('button');
                input.textContent = setting.label;
                input.type = 'button';
                break;

            default: // 'text', 'password', 'number', etc.
                input = document.createElement('input');
                input.type = setting.type || 'text';
                input.value = valueToSet;
                if (setting.placeholder) input.placeholder = setting.placeholder;
                break;
        }

        if (input) {
            input.id = `${idPrefix}${setting.id}`;
            input.setAttribute('data-setting-id', setting.id);

            // Set value for select after options are populated
            if (setting.type === 'select') {
                let optionToSelect = Array.from(input.options).find(opt => opt.value === valueToSet);
                if (!optionToSelect && valueToSet) {
                    const newOption = document.createElement('option');
                    newOption.value = valueToSet;
                    newOption.textContent = `${valueToSet} (saved)`;
                    input.appendChild(newOption);
                    optionToSelect = newOption;
                }
                if (optionToSelect) {
                    optionToSelect.selected = true;
                }
            }

            // Append the input to the main element `el`, unless it's a checkbox (already in label)
            if (setting.type !== 'checkbox') {
                el.appendChild(input);
            }

            // Attach listeners
            if (setting.listeners) {
                for (const [event, listener] of Object.entries(setting.listeners)) {
                    input.addEventListener(event, (e) => listener(e, el, context));
                }
            }
        }

        // Add any action buttons for this setting
        if (actions[setting.id]) {
            const buttonContainer = document.createElement('div');
            buttonContainer.classList.add('setting-actions');
            actions[setting.id].forEach(action => {
                const button = document.createElement('button');
                button.id = action.id;
                button.textContent = action.label;
                button.addEventListener('click', (e) => action.onClick(e, el, context));
                buttonContainer.appendChild(button);
            });
            el.appendChild(buttonContainer);
        }

        fragment.appendChild(el);
    });

    return fragment;
}
