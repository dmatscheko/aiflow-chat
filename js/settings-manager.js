/**
 * @fileoverview Manages all application settings, including UI rendering and storage.
 * This file provides a centralized way to handle application settings, from their
 * definition and storage to dynamically rendering a user interface for them.
 * It includes a generic function `createSettingsUI` that can build an entire
 * settings panel from a declarative configuration object.
 */

'use.strict';

import { pluginManager } from './plugin-manager.js';
import { createElement, createButton, createInput, createTextarea, createSelect } from './ui/ui-elements.js';

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
            fragment.appendChild(createElement('hr'));
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
        let labelEl;

        const handle_change = (e) => {
            const target = e.target;
            let newValue;
            if (['checkbox', 'radio'].includes(target.type)) {
                newValue = target.checked;
            } else if (target.type === 'select-multiple') {
                newValue = Array.from(target.selectedOptions).map(opt => opt.value);
            } else if (target.type === 'range' || target.type === 'number') {
                newValue = parseFloat(target.value);
            } else {
                newValue = target.value;
            }
            onChange?.(settingPath, newValue, context, target);
        };

        try {
            switch (setting.type) {
                case 'fieldset':
                    const legend = createElement('legend', { textContent: setting.label });
                    container = createElement('fieldset', { id: settingId, children: [legend] });
                    if (setting.children) {
                        const childFragment = createSettingsUI(setting.children, currentValue || {}, onChange, `${settingId}-`, context, settingPath, dependencyMap);
                        container.appendChild(childFragment);
                    }
                    break;

                case 'checkbox-list':
                case 'radio-list':
                    const items = (setting.options || []).map(opt => {
                        const itemInput = createInput({
                            attributes: { type: setting.type.startsWith('checkbox') ? 'checkbox' : 'radio', value: opt.value, name: settingId },
                            events: { change: setting.type.startsWith('checkbox') ? () => {
                                const selected = Array.from(container.querySelectorAll('input:checked')).map(c => c.value);
                                onChange?.(settingPath, selected, context, itemInput);
                            } : (e) => {
                                if (e.target.checked) onChange?.(settingPath, e.target.value, context, e.target);
                            }},
                        });
                        if (setting.type.startsWith('checkbox')) {
                            itemInput.checked = new Set(currentValue || []).has(opt.value);
                        } else {
                            itemInput.checked = currentValue === opt.value;
                        }
                        return createElement('label', { className: `${setting.type.startsWith('checkbox') ? 'checkbox' : 'radio'}-label`, children: [itemInput, ` ${opt.label}`] });
                    });
                    if (setting.label) {
                        items.unshift(createElement('label', { textContent: setting.label }));
                    }
                    container = createElement('div', { id: settingId, className: `setting ${setting.type}`, children: items });
                    break;

                case 'custom':
                     if (typeof setting.render === 'function') {
                        container = createElement('div', { className: 'setting', id: settingId });
                        const customContent = setting.render({ setting, currentValue, onChange, settingPath, context });
                        if (customContent) container.appendChild(customContent);
                    } else {
                        console.warn('Custom setting missing render function:', setting);
                        return;
                    }
                    break;

                default:
                    const valueToSet = currentValue ?? setting.default ?? '';
                    const inputOptions = {
                        id: settingId,
                        attributes: { 'data-path': settingPath, required: setting.required },
                        events: { change: handle_change },
                    };

                    if (setting.type === 'textarea') {
                        input = createTextarea({ ...inputOptions, value: valueToSet, attributes: { ...inputOptions.attributes, rows: setting.rows || 4 } });
                    } else if (setting.type === 'select') {
                        const selectOptions = (setting.options || []).map(opt => ({ value: typeof opt === 'string' ? opt : opt.value, label: typeof opt === 'string' ? opt : opt.label }));
                        input = createSelect(selectOptions, valueToSet, { ...inputOptions, attributes: { ...inputOptions.attributes, multiple: setting.multiple } });
                    } else {
                        const type = setting.type || 'text';
                        input = createInput({ ...inputOptions, attributes: { ...inputOptions.attributes, type, placeholder: setting.placeholder } });
                        if (['checkbox', 'radio'].includes(type)) {
                            input.checked = !!valueToSet;
                        } else {
                            input.value = valueToSet;
                        }
                    }

                    const children = [];
                    if (setting.label) {
                        const requiredMark = setting.required ? ' *' : '';
                        labelEl = createElement('label', { textContent: `${setting.label}${requiredMark}`, attributes: { for: settingId } });
                    }

                    if (['checkbox', 'radio'].includes(input.type) && labelEl) {
                        labelEl.classList.add(`${input.type}-label`);
                        labelEl.appendChild(input);
                        children.push(labelEl);
                    } else {
                        if (labelEl) children.push(labelEl);
                        children.push(input);
                    }

                    if (setting.type === 'range') {
                        const valueSpan = createElement('span', { id: `${settingId}-value`, textContent: valueToSet });
                        children.push(valueSpan);
                        input.addEventListener('input', () => { valueSpan.textContent = input.value; });
                    }
                    if (setting.description) {
                        children.push(createElement('small', { className: 'help-text', textContent: setting.description }));
                    }
                    if (setting.errorSpan) {
                        children.push(createElement('span', { className: 'error' }));
                    }

                    container = createElement('div', { className: `setting ${setting.className || ''}`, children });
            }

            if (setting.actions) {
                const buttonContainer = createElement('div', { className: 'setting-actions' });
                setting.actions.forEach(action => {
                    buttonContainer.appendChild(createButton(action.label, {
                        id: action.id,
                        events: { click: (e) => action.onClick(e, input || container) },
                    }));
                });
                container.appendChild(buttonContainer);
            }

            if (setting.dependsOn) {
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
