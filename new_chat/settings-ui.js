/**
 * @fileoverview Functions for creating settings UI components.
 */

'use strict';

/**
 * Creates a container for settings.
 * @param {string} title - The title of the settings container.
 * @returns {HTMLFieldSetElement} The created fieldset element.
 */
function createSettingsContainer(title) {
    const container = document.createElement('fieldset');
    container.className = 'settings-group';
    const legend = document.createElement('legend');
    legend.textContent = title;
    container.appendChild(legend);
    return container;
}

/**
 * Creates a single setting input element.
 * @param {object} setting - The setting object.
 * @param {string} prefix - The prefix for the element IDs.
 * @returns {HTMLDivElement} The created setting element.
 */
function createSettingElement(setting, prefix = '') {
    const el = document.createElement('div');
    el.classList.add('setting');

    const label = document.createElement('label');
    const inputId = `setting-${prefix}${setting.id}`;
    label.setAttribute('for', inputId);
    label.textContent = setting.label;
    el.appendChild(label);

    let input;
    if (setting.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = setting.rows || 4;
    } else if (setting.type === 'select') {
        input = document.createElement('select');
        if (setting.options) {
            setting.options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
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
        valueSpan.id = `${inputId}-value`;
        valueSpan.textContent = setting.default;
        el.appendChild(valueSpan);
        input.addEventListener('input', () => valueSpan.textContent = input.value);
    } else if (setting.type === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = setting.default || false;
        // Align checkbox with label differently
        el.classList.add('setting-checkbox');
    } else {
        input = document.createElement('input');
        input.type = setting.type || 'text';
        if(setting.placeholder) input.placeholder = setting.placeholder;
    }

    input.id = inputId;
    input.dataset.settingId = setting.id;
    input.value = setting.default;
    el.appendChild(input);

    return el;
}

/**
 * Creates and populates the model settings section.
 * @param {Array<Object>} modelSettings - The array of model setting definitions.
 * @param {string} [prefix=''] - A prefix for element IDs to ensure uniqueness.
 * @returns {DocumentFragment} A fragment containing the rendered model settings.
 */
function createModelSettings(modelSettings, prefix = '') {
    const fragment = document.createDocumentFragment();
    modelSettings.forEach(setting => {
        // The 'model' setting needs special handling for the refresh button.
        if (setting.id === 'model' && prefix === '') { // Only add refresh to main settings
            const el = createSettingElement(setting, prefix);
            const refreshBtn = document.createElement('button');
            refreshBtn.id = 'refresh-models';
            refreshBtn.textContent = 'Refresh';
            el.appendChild(refreshBtn);
            fragment.appendChild(el);
        } else {
            fragment.appendChild(createSettingElement(setting, prefix));
        }
    });
    return fragment;
}

/**
 * Creates and populates the MCP settings section.
 * @param {Array<Object>} mcpTools - The array of available MCP tools.
 * @param {string} [prefix=''] - A prefix for element IDs.
 * @returns {DocumentFragment} A fragment containing the rendered MCP settings.
 */
function createMcpSettings(mcpTools, prefix = '') {
    const fragment = document.createDocumentFragment();
    const container = createSettingsContainer('MCP Tool Access');

    const allToolsCheckbox = createSettingElement({
        id: `${prefix}mcp-all-tools`,
        label: 'Enable All Tools',
        type: 'checkbox',
        default: true
    }, '');
    container.appendChild(allToolsCheckbox);

    const toolList = document.createElement('div');
    toolList.className = 'mcp-tool-list';
    container.appendChild(toolList);

    mcpTools.forEach(tool => {
        const toolCheckbox = createSettingElement({
            id: `${prefix}mcp-tool-${tool.name}`,
            label: tool.name.replace(/_/g, ' '),
            type: 'checkbox',
            default: true
        }, '');
        toolCheckbox.dataset.toolName = tool.name;
        toolList.appendChild(toolCheckbox);
    });

    // Toggle individual tool checkboxes based on "Enable All"
    const allCheckbox = allToolsCheckbox.querySelector('input');
    allCheckbox.addEventListener('change', () => {
        const isChecked = allCheckbox.checked;
        toolList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = isChecked;
            cb.disabled = isChecked;
        });
    });

    // Initial state
    toolList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.disabled = allCheckbox.checked;
    });


    fragment.appendChild(container);
    return fragment;
}

export { createSettingsContainer, createSettingElement, createModelSettings, createMcpSettings };
