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
 * Gets a nested property from an object using a dot-notation string.
 * @param {object} obj - The object to query.
 * @param {string} path - The dot-notation path to the property.
 * @returns {any} The value of the property, or undefined if not found.
 */
function getPropertyByPath(obj, path) {
    if (!path) return undefined;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Sets a nested property on an object using a dot-notation string.
 * @param {object} obj - The object to modify.
 * @param {string} path - The dot-notation path to the property.
 * @param {any} value - The value to set.
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
 * @typedef {import('./main.js').Setting} Setting
 * @typedef {import('./tool-processor.js').ToolSchema} ToolSchema
 */

/**
 * @callback SettingChangedCallback
 * @param {string} id - The dot-notation ID of the setting that changed (e.g., 'name', 'modelSettings.apiKey').
 * @param {any} newValue - The new value of the setting.
 * @param {string} context - The context string passed to createSettingsUI.
 * @param {HTMLElement} inputElement - The specific input element that triggered the change.
 */

/**
 * Creates and manages a settings UI from a declarative definition.
 * @param {Setting[]} settings - The array of setting definitions.
 * @param {object} currentValues - An object containing the current values for the settings.
 * @param {SettingChangedCallback} [onChange] - A single callback function to handle all data changes.
 * @param {string} [idPrefix=''] - A prefix for generated element IDs.
 * @param {string} [context=''] - A context string to be passed to the onChange callback.
 * @param {string} [pathPrefix=''] - A prefix for the dot-notation path.
 * @param {Map<string, any[]>} [dependencyMap] - For internal recursive use.
 * @returns {DocumentFragment} A fragment containing the rendered and interactive settings UI.
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

                default:
                    container = document.createElement('div');
                    container.classList.add('setting');

                    if (setting.label) {
                        label = document.createElement('label');
                        label.setAttribute('for', settingId);
                        label.textContent = setting.label;
                        container.appendChild(label);
                    }

                    const valueToSet = currentValue ?? setting.default ?? '';

                    if (setting.type === 'textarea') {
                        input = document.createElement('textarea');
                        input.rows = 4;
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
                        let optionToSelect = Array.from(input.options).find(opt => opt.value === valueToSet);
                        if (!optionToSelect && valueToSet) {
                            const newOption = document.createElement('option');
                            newOption.value = valueToSet;
                            newOption.textContent = `${valueToSet} (saved)`;
                            input.appendChild(newOption);
                            optionToSelect = newOption;
                        }
                        if (optionToSelect) optionToSelect.selected = true;

                    } else if (setting.type === 'range') {
                        input = document.createElement('input');
                        input.type = 'range';
                        input.min = setting.min;
                        input.max = setting.max;
                        input.step = setting.step;
                        input.value = valueToSet;
                        const valueSpan = document.createElement('span');
                        valueSpan.id = `${settingId}-value`;
                        valueSpan.textContent = valueToSet;
                        container.appendChild(valueSpan);
                        input.addEventListener('input', () => { valueSpan.textContent = input.value; });
                    } else {
                        input = document.createElement('input');
                        input.type = setting.type || 'text';
                        if (setting.placeholder) input.placeholder = setting.placeholder;
                        if (input.type === 'checkbox') {
                            input.checked = !!valueToSet;
                        } else {
                            input.value = valueToSet;
                        }
                    }

                    input.id = settingId;
                    input.dataset.path = settingPath;

                    input.addEventListener('change', (e) => {
                        const target = e.target;
                        let newValue;
                        if (target.type === 'checkbox') {
                            newValue = target.checked;
                        } else if (target.type === 'range' || target.type === 'number') {
                            newValue = parseFloat(target.value);
                        } else {
                            newValue = target.value;
                        }
                        onChange?.(settingPath, newValue, context, target);
                    });

                    if (input) {
                        container.appendChild(input);
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
                        action.onClick(e, input);
                    });
                    buttonContainer.appendChild(button);
                });
                container.appendChild(buttonContainer);
            }
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
            const controllerElement = fragment.querySelector(`#${controllerId}`);
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
