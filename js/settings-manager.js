/**
 * @fileoverview Manages all application settings, including UI rendering and storage.
 * This file provides a centralized way to handle application settings, from their
 * definition and storage to dynamically rendering a user interface for them.
 * It includes a generic function `createSettingsUI` that can build an entire
 * settings panel from a declarative configuration object.
 */

'use.strict';

import { pluginManager } from './plugin-manager.js';

/**
 * @typedef {import('./main.js').App} App
 * @typedef {import('./main.js').Setting} Setting
 * @typedef {import('./tool-processor.js').ToolSchema} ToolSchema
 */

// --- Private Helper Functions ---

/**
 * Safely gets a nested property from an object using a dot-notation string.
 * For example, `getPropertyByPath(obj, 'a.b.c')` is equivalent to `obj.a.b.c`.
 * @param {object} obj The object to query.
 * @param {string} path The dot-notation path to the property.
 * @returns {any} The value of the property, or `undefined` if the path is invalid or not found.
 * @example
 * const obj = { a: { b: { c: 10 } } };
 * getPropertyByPath(obj, 'a.b.c'); // Returns 10
 * getPropertyByPath(obj, 'a.d');   // Returns undefined
 */
export function getPropertyByPath(obj, path) {
    if (!path) return undefined;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Safely sets a nested property on an object using a dot-notation string.
 * It creates nested objects if they do not exist along the path.
 * @param {object} obj The object to modify.
 * @param {string} path The dot-notation path to the property.
 * @param {any} value The value to set at the specified path.
 * @example
 * const obj = { a: {} };
 * setPropertyByPath(obj, 'a.b.c', 20);
 * // obj is now { a: { b: { c: 20 } } }
 */
export function setPropertyByPath(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((acc, key) => {
        if (!acc[key] || typeof acc[key] !== 'object') {
            acc[key] = {};
        }
        return acc[key];
    }, obj);
    target[lastKey] = value;
}

/**
 * Manages the definition, storage, and UI rendering of application settings.
 * This class is intended to be extended by plugins to manage their own settings.
 * @class
 */
export class SettingsManager {
    /**
     * Creates an instance of SettingsManager.
     * @param {App} app - The main application instance.
     */
    constructor(app) {
        /**
         * The main application instance.
         * @type {App}
         */
        this.app = app;
    }
}


/**
 * A callback function that is invoked when a setting's value changes in the UI.
 * @callback SettingChangedCallback
 * @param {string} id - The dot-notation ID of the setting that changed (e.g., 'name', 'modelSettings.apiKey').
 * @param {any} newValue - The new value of the setting.
 * @param {string} context - The context string that was passed to `createSettingsUI`, useful for identifying which settings panel triggered the change.
 * @param {HTMLElement} inputElement - The specific HTML input element that triggered the change event.
 */

/**
 * Creates and manages a settings UI from a declarative array of setting definitions.
 * This powerful function recursively builds a complete HTML form structure based on
 * the provided configuration, handling various input types, dependencies between fields,
 * and data binding.
 *
 * @param {Setting[]} settings - The array of setting definitions that describe the UI to be created.
 * @param {object} currentValues - An object containing the current values for the settings, which will be used to populate the form fields.
 * @param {SettingChangedCallback} [onChange] - A single callback function that will be invoked whenever any setting's value changes.
 * @param {string} [idPrefix=''] - A prefix to be added to all generated HTML element IDs to ensure uniqueness in complex UIs.
 * @param {string} [context=''] - A context string that is passed through to the `onChange` callback, useful for identifying the source of the change.
 * @param {string} [pathPrefix=''] - (For internal use) A prefix for the dot-notation path used in recursive calls to build nested setting paths.
 * @param {Map<string, any[]>} [dependencyMap] - (For internal use) A map used to track dependencies between settings for visibility toggling.
 * @returns {DocumentFragment} A `DocumentFragment` containing the fully rendered and interactive settings UI. This can be appended to any DOM element.
 */
export function createSettingsUI(settings, currentValues, onChange, idPrefix = '', context = '', pathPrefix = '', dependencyMap = new Map()) {
    const fragment = document.createDocumentFragment();
    const isTopLevel = !pathPrefix; // We are at the top level if pathPrefix is empty

    settings.forEach(setting => {
        if (setting.type === 'divider') {
            fragment.appendChild(document.createElement('hr'));
            return;
        }

        if (!setting.id) {
            console.warn('Skipping setting because it has no ID:', setting);
            return;
        }

        const settingId = `${idPrefix}${setting.id}`;
        const settingPath = pathPrefix ? `${pathPrefix}.${setting.id}` : setting.id;
        const currentValue = getPropertyByPath(currentValues, setting.id);

        let container;
        let input;
        let label;

        try {
            switch (setting.type) {
                case 'fieldset':
                    container = document.createElement('fieldset');
                    container.id = settingId;
                    const legend = document.createElement('legend');
                    legend.textContent = setting.label;
                    container.appendChild(legend);
                    if (setting.children) {
                        const childFragment = createSettingsUI(setting.children, currentValue || {}, onChange, `${settingId}-`, context, settingPath, dependencyMap);
                        container.appendChild(childFragment);
                    }
                    break;

                case 'checkbox-list':
                    container = document.createElement('div');
                    container.id = settingId;
                    container.classList.add('setting', 'checkbox-list');
                    if (setting.label) {
                        label = document.createElement('label');
                        label.textContent = setting.label;
                        container.appendChild(label);
                    }
                    const allowedSet = new Set(currentValue || []);
                    (setting.options || []).forEach(opt => {
                        const cbLabel = document.createElement('label');
                        cbLabel.classList.add('checkbox-label');
                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.value = opt.value;
                        cb.checked = allowedSet.has(opt.value);
                        cb.addEventListener('change', () => {
                            const selected = Array.from(container.querySelectorAll('input:checked')).map(c => c.value);
                            onChange?.(settingPath, selected, context, cb);
                        });
                        cbLabel.appendChild(cb);
                        cbLabel.appendChild(document.createTextNode(` ${opt.label}`));
                        container.appendChild(cbLabel);
                    });
                    break;

                case 'radio-list':
                    container = document.createElement('div');
                    container.id = settingId;
                    container.classList.add('setting', 'radio-list');
                    if (setting.label) {
                        label = document.createElement('label');
                        label.textContent = setting.label;
                        container.appendChild(label);
                    }
                    const radioName = settingId; // Use settingId as the shared name for mutual exclusivity
                    (setting.options || []).forEach(opt => {
                        const radioLabel = document.createElement('label');
                        radioLabel.classList.add('radio-label');
                        const radio = document.createElement('input');
                        radio.type = 'radio';
                        radio.name = radioName;
                        radio.value = opt.value;
                        radio.checked = currentValue === opt.value;
                        radio.addEventListener('change', () => {
                            if (radio.checked) {
                                onChange?.(settingPath, radio.value, context, radio);
                            }
                        });
                        radioLabel.appendChild(radio);
                        radioLabel.appendChild(document.createTextNode(` ${opt.label}`));
                        container.appendChild(radioLabel);
                    });
                    break;

                // Support for custom renderers
                case 'custom':
                    if (typeof setting.render === 'function') {
                        container = document.createElement('div');
                        container.classList.add('setting');
                        container.id = settingId;
                        const customContent = setting.render({ setting, currentValue, onChange, settingPath, context });
                        if (customContent) container.appendChild(customContent);
                    } else {
                        console.warn('Custom setting missing render function:', setting);
                        return;
                    }
                    break;

                default:
                    container = document.createElement('div');
                    container.classList.add('setting');
                    // Add custom class if provided
                    if (setting.className) container.classList.add(setting.className);

                    const valueToSet = currentValue ?? setting.default ?? '';

                    // Create and configure the input element first
                    if (setting.type === 'textarea') {
                        input = document.createElement('textarea');
                        input.rows = setting.rows || 4; // Allow custom rows
                        input.value = valueToSet;
                    } else if (setting.type === 'select') {
                        input = document.createElement('select');
                        // Support multiple select
                        if (setting.multiple) {
                            input.multiple = true;
                            const selectedSet = new Set(Array.isArray(valueToSet) ? valueToSet : [valueToSet]);
                            if (setting.options) {
                                setting.options.forEach(opt => {
                                    const option = document.createElement('option');
                                    option.value = typeof opt === 'string' ? opt : opt.value;
                                    option.textContent = typeof opt === 'string' ? opt : opt.label;
                                    option.selected = selectedSet.has(option.value);
                                    input.appendChild(option);
                                });
                            }
                        } else {
                            if (setting.options) {
                                setting.options.forEach(opt => {
                                    const option = document.createElement('option');
                                    option.value = typeof opt === 'string' ? opt : opt.value;
                                    option.textContent = typeof opt === 'string' ? opt : opt.label;
                                    input.appendChild(option);
                                });
                            }
                            let optionToSelect = Array.from(input.options).find(opt => opt.value === valueToSet);
                            if (!optionToSelect && valueToSet) {
                                const newOption = document.createElement('option');
                                newOption.value = valueToSet;
                                newOption.textContent = `${valueToSet} (saved)`;
                                input.appendChild(newOption);
                                optionToSelect = newOption;
                            }
                            if (optionToSelect) optionToSelect.selected = true;
                        }
                    } else if (setting.type === 'range') {
                        input = document.createElement('input');
                        input.type = 'range';
                        input.min = setting.min ?? 0;
                        input.max = setting.max ?? 100;
                        input.step = setting.step ?? 1;
                        input.value = valueToSet;
                    } else {
                        input = document.createElement('input');
                        input.type = setting.type || 'text'; // Handles 'color', 'date', 'file', 'email', etc.
                        if (setting.placeholder) input.placeholder = setting.placeholder;
                        if (['checkbox', 'radio'].includes(input.type)) {
                            input.checked = !!valueToSet;
                        } else {
                            input.value = valueToSet;
                        }
                    }

                    input.id = settingId;
                    input.dataset.path = settingPath;

                    // Required attribute
                    if (setting.required) input.required = true;

                    input.addEventListener('change', (e) => {
                        const target = e.target;
                        let newValue;
                        if (['checkbox', 'radio'].includes(target.type)) {
                            newValue = target.checked;
                        } else if (target.type === 'select-multiple') { // Handle multi-select
                            newValue = Array.from(target.selectedOptions).map(opt => opt.value);
                        } else if (target.type === 'range' || target.type === 'number') {
                            newValue = parseFloat(target.value);
                        } else {
                            newValue = target.value;
                        }
                        onChange?.(settingPath, newValue, context, target);
                    });

                    // Now, construct the DOM structure based on the input type
                    if (['checkbox', 'radio'].includes(input.type)) {
                        if (setting.label) {
                            label = document.createElement('label');
                            label.classList.add(`${input.type}-label`);
                            // Asterisk for required
                            label.appendChild(document.createTextNode(setting.required ? `${setting.label} *` : setting.label));
                            label.appendChild(input);
                            container.appendChild(label);
                        } else {
                            // If there's no label, just append the input itself
                            container.appendChild(input);
                            // Aria-label for accessibility
                            if (setting.description) input.setAttribute('aria-label', setting.description);
                        }
                    } else {
                        // Original logic for all other input types
                        if (setting.label) {
                            label = document.createElement('label');
                            label.setAttribute('for', settingId);
                            // Optional required asterisk
                            const requiredMark = setting.required ? ' *' : '';
                            label.textContent = `${setting.label}${requiredMark}`;
                            container.appendChild(label);
                        }

                        if (input) {
                            container.appendChild(input);
                        }

                        if (setting.type === 'range') {
                            const valueSpan = document.createElement('span');
                            valueSpan.id = `${settingId}-value`;
                            valueSpan.textContent = valueToSet;
                            container.appendChild(valueSpan);
                            input.addEventListener('input', () => { valueSpan.textContent = input.value; });
                        }
                    }

                    // Description/help text
                    if (setting.description) {
                        const help = document.createElement('small');
                        help.classList.add('help-text');
                        help.textContent = setting.description;
                        container.appendChild(help);
                    }

                    // Error placeholder
                    if (setting.errorSpan) {
                        const errorSpan = document.createElement('span');
                        errorSpan.classList.add('error');
                        container.appendChild(errorSpan);
                    }

            }

            if (setting.actions) {
                const buttonContainer = document.createElement('div');
                buttonContainer.classList.add('setting-actions');
                setting.actions.forEach(action => {
                    const button = document.createElement('button');
                    button.id = action.id;
                    button.textContent = action.label;
                    button.type = 'button';
                    button.addEventListener('click', (e) => {
                        // Pass the input element if it exists, otherwise the container.
                        // This makes the behavior consistent for fieldsets vs. regular inputs.
                        action.onClick(e, input || container);
                    });
                    buttonContainer.appendChild(button);
                });
                container.appendChild(buttonContainer);
            }

            if (setting.dependsOn) {
                // The controller's ID is constructed relative to the current element's prefix.
                const controllerId = `${idPrefix}${setting.dependsOn}`;
                if (!dependencyMap.has(controllerId)) {
                    dependencyMap.set(controllerId, []);
                }
                dependencyMap.get(controllerId).push({
                    dependentElement: container,
                    requiredValue: setting.dependsOnValue,
                });
            }

            fragment.appendChild(container);

        } catch (error) {
            console.error('Error creating setting UI for:', setting, error);
        }
    });

    // Only process dependencies at the top-level call, after the whole fragment is built.
    if (isTopLevel) {
        dependencyMap.forEach((dependents, controllerId) => {
            // The controller might not be in the fragment if it's in a different part of a complex form,
            // so we check the whole document as a fallback.
            const controllerElement = fragment.querySelector(`#${controllerId}`) || document.querySelector(`#${controllerId}`);
            if (controllerElement) {
                const updateDependents = () => {
                    const currentValue = controllerElement.type === 'checkbox' ? controllerElement.checked : controllerElement.value;
                    dependents.forEach(({ dependentElement, requiredValue }) => {
                        const shouldBeVisible = currentValue === requiredValue;
                        dependentElement.style.display = shouldBeVisible ? 'block' : 'none';
                    });
                };
                controllerElement.addEventListener('change', updateDependents);
                updateDependents(); // Initial check
            } else {
                console.warn(`Dependency controller element with ID #${controllerId} not found.`);
            }
        });
    }

    return fragment;
}
