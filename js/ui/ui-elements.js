
/**
 * UIElementCreator is a utility class for creating common HTML elements in a standardized way.
 * It simplifies the process of element creation and property assignment.
 */
export class UIElementCreator {
    /**
     * Creates an HTML element with the specified tag and properties.
     *
     * @param {string} tag - The HTML tag for the element (e.g., 'div', 'button', 'input').
     * @param {object} [properties={}] - An object containing properties to assign to the element.
     *   - 'className' sets the class attribute.
     *   - 'textContent' sets the inner text.
     *   - 'innerHTML' sets the inner HTML.
     *   - 'style' is an object for CSS styles (e.g., { color: 'red', backgroundColor: 'blue' }).
     *   - 'events' is an object for event listeners (e.g., { click: (event) => { ... } }).
     *   - Any other key will be set as an attribute on the element (e.g., 'id', 'type', 'src').
     * @returns {HTMLElement} The newly created HTML element.
     */
    static createElement(tag, properties = {}) {
        const element = document.createElement(tag);

        Object.entries(properties).forEach(([key, value]) => {
            if (value === undefined || value === null) return;

            switch (key) {
                case 'className':
                    element.className = value;
                    break;
                case 'textContent':
                    element.textContent = value;
                    break;
                case 'innerHTML':
                    element.innerHTML = value;
                    break;
                case 'style':
                    Object.assign(element.style, value);
                    break;
                case 'events':
                    Object.entries(value).forEach(([event, listener]) => {
                        element.addEventListener(event, listener);
                    });
                    break;
                default:
                    element.setAttribute(key, value);
            }
        });

        return element;
    }

    /**
     * Creates a button element.
     *
     * @param {string} label - The text to display on the button.
     * @param {object} [properties={}] - Additional properties for the button element.
     * @returns {HTMLButtonElement} The created button element.
     */
    static createButton(label, properties = {}) {
        return this.createElement('button', { textContent: label, ...properties });
    }

    /**
     * Creates an input element.
     *
     * @param {string} type - The type of the input (e.g., 'text', 'password', 'checkbox').
     * @param {object} [properties={}] - Additional properties for the input element.
     * @returns {HTMLInputElement} The created input element.
     */
    static createInput(type, properties = {}) {
        return this.createElement('input', { type, ...properties });
    }

    /**
     * Creates a select (dropdown) element.
     *
     * @param {Array<object>} options - An array of option objects. Each object should have 'value' and 'label' properties.
     * @param {object} [properties={}] - Additional properties for the select element.
     * @returns {HTMLSelectElement} The created select element.
     */
    static createSelect(options, properties = {}) {
        const select = this.createElement('select', properties);
        options.forEach(opt => {
            const optionElement = this.createElement('option', {
                value: opt.value,
                textContent: opt.label,
            });
            if (opt.selected) {
                optionElement.selected = true;
            }
            select.appendChild(optionElement);
        });
        return select;
    }

    /**
     * Creates a textarea element.
     *
     * @param {object} [properties={}] - Properties for the textarea element.
     * @returns {HTMLTextAreaElement} The created textarea element.
     */
    static createTextarea(properties = {}) {
        return this.createElement('textarea', properties);
    }

    /**
     * Creates a label element.
     *
     * @param {string} text - The text content of the label.
     * @param {string} forId - The ID of the input element this label is for.
     * @param {object} [properties={}] - Additional properties for the label element.
     * @returns {HTMLLabelElement} The created label element.
     */
    static createLabel(text, forId, properties = {}) {
        return this.createElement('label', { for: forId, textContent: text, ...properties });
    }

    /**
     * Creates a div element.
     * @param {object} [properties={}] - Properties for the div element.
     * @returns {HTMLDivElement} The created div element.
     */
    static createDiv(properties = {}) {
        return this.createElement('div', properties);
    }

    /**
     * Creates a span element.
     * @param {object} [properties={}] - Properties for the span element.
     * @returns {HTMLSpanElement} The created span element.
     */
    static createSpan(properties = {}) {
        return this.createElement('span', properties);
    }
}
