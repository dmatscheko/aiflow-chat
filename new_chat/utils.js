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
 * @typedef {import('./main.js').SettingListener} SettingListener
 */

/**
 * @typedef {object} SettingContext
 * @property {string} id - The id of the setting.
 * @property {HTMLElement} element - The primary input element for the setting.
 * @property {string} settingsContext - A string identifying the context (e.g., 'main-settings', 'agent-editor').
 * @property {() => any} getValue - A function to get the current value from the input.
 * @property {(value: any) => void} setValue - A function to set the current value of the input.
 * @property {HTMLElement} container - The top-level container element for the setting (the div wrapper).
 * @property {HTMLElement | null} parentElement - The parent element the fragment is being appended to.
 */


/**
 * Creates a DocumentFragment containing HTML elements for a given set of settings.
 * This is the new, declarative version of the settings UI generator.
 * @param {Setting[]} settings - The settings definitions.
 * @param {Object.<string, any>} currentValues - The current values for the settings, keyed by setting ID.
 * @param {string} idPrefix - A prefix to apply to all generated element IDs to ensure uniqueness.
 * @param {string} settingsContext - A string identifying the context (e.g., 'main-settings', 'agent-editor').
 * @returns {DocumentFragment} A fragment containing the rendered settings UI.
 */
export function createSettingsUI(settings, currentValues, idPrefix, settingsContext) {
    const fragment = document.createDocumentFragment();

    settings.forEach(setting => {
        if (!setting || !setting.id) {
            console.warn('Skipping invalid setting object:', setting);
            return;
        }
        const el = document.createElement('div');
        el.classList.add('setting');
        el.dataset.settingId = setting.id;

        if (setting.label) {
            const label = document.createElement('label');
            label.setAttribute('for', `${idPrefix}${setting.id}`);
            label.textContent = setting.label;
            el.appendChild(label);
        }

        let input;
        let getValue, setValue;
        const currentValue = currentValues[setting.id] ?? setting.default;

        switch (setting.type) {
            case 'textarea':
                input = document.createElement('textarea');
                input.rows = setting.rows || 4;
                input.value = currentValue ?? '';
                getValue = () => input.value;
                setValue = (v) => { input.value = v; };
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
                // Fallback for custom values not in options list
                if (currentValue && !setting.options?.some(opt => (typeof opt === 'string' ? opt : opt.value) === currentValue)) {
                    const customOption = document.createElement('option');
                    customOption.value = currentValue;
                    customOption.textContent = `${currentValue} (custom)`;
                    input.appendChild(customOption);
                }
                input.value = currentValue ?? '';
                getValue = () => input.value;
                setValue = (v) => { input.value = v; };
                break;

            case 'range':
                input = document.createElement('input');
                input.type = 'range';
                input.min = setting.min;
                input.max = setting.max;
                input.step = setting.step;
                input.value = currentValue ?? '0';

                const valueSpan = document.createElement('span');
                valueSpan.id = `${idPrefix}${setting.id}-value`;
                valueSpan.textContent = input.value;
                el.appendChild(valueSpan);

                // Add a default listener to update the span, can be overridden
                input.addEventListener('input', () => { valueSpan.textContent = input.value; });

                getValue = () => input.value;
                setValue = (v) => {
                    input.value = v;
                    valueSpan.textContent = v;
                };
                break;

            case 'checkbox':
                input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = currentValue ?? false;
                // For a single checkbox, the label is usually handled differently
                // We wrap the input in the label text for better clickability
                const checkLabel = el.querySelector('label');
                if (checkLabel) {
                    checkLabel.textContent = ''; // Clear existing text
                    checkLabel.appendChild(input);
                    checkLabel.appendChild(document.createTextNode(` ${setting.label}`));
                }
                getValue = () => input.checked;
                setValue = (v) => { input.checked = !!v; };
                break;

            case 'checkbox-list': {
                // This type creates a fieldset with multiple checkboxes
                input = document.createElement('fieldset');
                const legend = document.createElement('legend');
                legend.textContent = setting.label; // Use the main label for the legend
                input.appendChild(legend);

                const currentListValues = currentValue || { allowAll: false, allowed: [] };
                const allowedSet = new Set(currentListValues.allowed || []);
                const checkboxes = [];

                // "Allow All" checkbox
                let allowAllCheckbox;
                if (setting.allowAll) {
                    const container = document.createElement('div');
                    const label = document.createElement('label');
                    allowAllCheckbox = document.createElement('input');
                    allowAllCheckbox.type = 'checkbox';
                    allowAllCheckbox.checked = currentListValues.allowAll;
                    label.appendChild(allowAllCheckbox);
                    label.appendChild(document.createTextNode(' Allow all'));
                    container.appendChild(label);
                    input.appendChild(container);
                }

                const listContainer = document.createElement('div');
                input.appendChild(listContainer);

                // Individual item checkboxes
                (setting.options || []).forEach(opt => {
                    const checkboxContainer = document.createElement('div');
                    const label = document.createElement('label');
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.value = opt.value;
                    checkbox.checked = allowedSet.has(opt.value);
                    checkboxes.push(checkbox);

                    label.appendChild(checkbox);
                    label.appendChild(document.createTextNode(` ${opt.label}`));
                    checkboxContainer.appendChild(label);
                    listContainer.appendChild(checkboxContainer);
                });

                const updateVisibility = () => {
                    if (allowAllCheckbox) {
                        listContainer.style.display = allowAllCheckbox.checked ? 'none' : '';
                    }
                };

                if (allowAllCheckbox) {
                    allowAllCheckbox.addEventListener('change', updateVisibility);
                }
                updateVisibility();

                getValue = () => ({
                    allowAll: allowAllCheckbox ? allowAllCheckbox.checked : false,
                    allowed: checkboxes.filter(cb => cb.checked).map(cb => cb.value),
                });

                setValue = (v) => {
                    const newValues = v || { allowAll: false, allowed: [] };
                    if (allowAllCheckbox) {
                        allowAllCheckbox.checked = newValues.allowAll;
                    }
                    const newAllowedSet = new Set(newValues.allowed || []);
                    checkboxes.forEach(cb => {
                        cb.checked = newAllowedSet.has(cb.value);
                    });
                    updateVisibility();
                };
                break;
            }

            default: // Catches text, password, number, etc.
                input = document.createElement('input');
                input.type = setting.type || 'text';
                if (setting.placeholder) input.placeholder = setting.placeholder;
                input.value = currentValue ?? '';
                getValue = () => input.value;
                setValue = (v) => { input.value = v; };
                break;
        }

        if (input) {
            input.id = `${idPrefix}${setting.id}`;
            el.appendChild(input);

            // The context object to be passed to listeners
            const context = {
                id: setting.id,
                element: input,
                settingsContext,
                getValue,
                setValue,
                container: el,
                get parentElement() {
                    // Defer access until appended to DOM
                    return fragment.parentElement;
                }
            };

            // Attach listeners
            if (setting.listeners) {
                for (const [eventName, listener] of Object.entries(setting.listeners)) {
                    // Use the `input` element as the primary target, but for fieldset, use the fieldset itself.
                    const targetElement = setting.type === 'checkbox-list' ? input : input;
                    targetElement.addEventListener(eventName, (event) => {
                        // Pass a fresh context object on each event
                        const eventContext = {
                            ...context,
                            // Re-evaluate parentElement in case it has changed
                            get parentElement() { return el.parentElement; }
                        };
                        listener(event, eventContext);
                    });
                }
            }
        }
        fragment.appendChild(el);
    });

    return fragment;
}
