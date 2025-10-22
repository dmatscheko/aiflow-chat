
import { UIElementCreator } from './ui/ui-elements.js';

/**
 * Creates a complete settings UI from a definition object.
 *
 * @param {Array<object>} settingsDefinition - An array of objects defining the settings.
 * @param {object} currentSettings - The object containing the current values for the settings.
 * @param {function(string, any): void} onSettingChanged - A callback function that is called when any setting's value changes.
 * @param {string} [idPrefix=''] - A prefix to add to all generated element IDs.
 * @param {string} [className=''] - A class name to add to the main container.
 * @returns {DocumentFragment} A document fragment containing the entire settings UI.
 */
export function createSettingsUI(settingsDefinition, currentSettings, onSettingChanged, idPrefix = '', className = '') {
    const fragment = document.createDocumentFragment();
    const container = UIElementCreator.createDiv({ className: className || 'settings-container' });

    const dependencies = new Map();

    settingsDefinition.forEach(def => {
        const fullPath = def.id; // In this refactored version, we pass the full path.
        const initialValue = getPropertyByPath(currentSettings, fullPath);

        const { wrapper, input } = createSettingInput(def, initialValue, (newValue) => {
            onSettingChanged(fullPath, newValue);

            // Check if this input controls any dependencies
            if (input && dependencies.has(input.id)) {
                 updateDependencies(input, dependencies.get(input.id));
            }
        }, idPrefix);

        if (def.dependsOn) {
            const key = `${idPrefix}${def.dependsOn}`;
            if (!dependencies.has(key)) {
                dependencies.set(key, []);
            }
            dependencies.get(key).push({
                element: wrapper,
                expectedValue: def.dependsOnValue,
            });
        }
        container.appendChild(wrapper);
    });

    // Initial check for all dependencies after elements are created
    dependencies.forEach((dependents, masterId) => {
        const masterElement = container.querySelector(`#${masterId}`);
        if (masterElement) {
            updateDependencies(masterElement, dependents);
        }
    });

    fragment.appendChild(container);
    return fragment;
}

function updateDependencies(masterElement, dependents) {
    const masterValue = masterElement.type === 'checkbox' ? masterElement.checked : masterElement.value;
    dependents.forEach(dep => {
        const shouldBeVisible = masterValue === dep.expectedValue;
        dep.element.style.display = shouldBeVisible ? '' : 'flex';
    });
}

function createSettingInput(def, initialValue, onChange, idPrefix = '') {
    const wrapper = UIElementCreator.createDiv({ className: `setting-wrapper ${def.className || ''}` });
    const inputId = `${idPrefix}${def.id}`;
    let input;

    if (def.label && def.type !== 'fieldset') {
        const label = UIElementCreator.createLabel(def.label, inputId);
        wrapper.appendChild(label);
    }

    const commonProps = { id: inputId, events: {} };

    switch (def.type) {
        case 'text':
        case 'number':
        case 'password':
        case 'range':
            commonProps.value = initialValue ?? def.default ?? '';
            commonProps.events.input = (e) => onChange(def.type === 'number' || def.type === 'range' ? parseFloat(e.target.value) : e.target.value);
            if (def.placeholder) commonProps.placeholder = def.placeholder;
            if (def.min) commonProps.min = def.min;
            if (def.max) commonProps.max = def.max;
            if (def.step) commonProps.step = def.step;
            input = UIElementCreator.createInput(def.type, commonProps);
            break;
        case 'checkbox':
            commonProps.checked = initialValue ?? def.default ?? false;
            commonProps.events.change = (e) => onChange(e.target.checked);
            input = UIElementCreator.createInput('checkbox', commonProps);
            break;
        case 'select':
            commonProps.events.change = (e) => onChange(e.target.value);
            input = UIElementCreator.createSelect(def.options || [], commonProps);
            input.value = initialValue ?? def.default ?? '';
            break;
        case 'textarea':
            commonProps.value = initialValue ?? def.default ?? '';
            commonProps.rows = def.rows || 3;
            commonProps.events.input = (e) => onChange(e.target.value);
            input = UIElementCreator.createTextarea(commonProps);
            break;
        case 'fieldset':
            const fieldset = UIElementCreator.createElement('fieldset', { id: inputId });
            if (def.label) {
                const legend = UIElementCreator.createElement('legend', { textContent: def.label });
                fieldset.appendChild(legend);
            }
            if (def.children) {
                const childSettings = createSettingsUI(def.children, initialValue || {}, (childKey, childValue) => {
                    const fullPath = `${def.id}.${childKey}`;
                    onChange(fullPath, childValue);
                }, `${inputId}-`);
                fieldset.appendChild(childSettings);
            }
            input = fieldset; // The fieldset itself is the main element
            break;
    }

    if (input) {
        wrapper.appendChild(input);
    }

    if (def.actions) {
        def.actions.forEach(action => {
            const button = UIElementCreator.createButton(action.label, {
                id: action.id,
                events: { click: (e) => action.onClick(e, input) }
            });
            wrapper.appendChild(button);
        });
    }

    return { wrapper, input };
}

export function getPropertyByPath(obj, path) {
    if (!path) return undefined;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

export function setPropertyByPath(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
}
