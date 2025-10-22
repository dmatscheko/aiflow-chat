
import { UIElementCreator } from './ui-elements.js';

/**
 * Manages the top panel (title bar) of the application.
 * Allows plugins to register and display controls like buttons and title elements.
 */
export class TopPanelManager {
    /**
     * @param {PluginManager} pluginManager - The application's plugin manager.
     */
    constructor(pluginManager) {
        this.pluginManager = pluginManager;
        this.titleBarConfig = {
            title: 'AI Chat',
            isEditable: false,
            buttons: {}
        };

        // Get DOM element
        this.topPanel = document.getElementById('top-panel');

        this.pluginManager.registerHook('onViewRendered', this.render.bind(this));
    }

    /**
     * Renders the top panel based on the current configuration.
     * This is typically called when the view is rendered or when the configuration changes.
     */
    render() {
        this.topPanel.innerHTML = ''; // Clear existing content

        // Allow plugins to modify the title bar configuration before rendering
        this.pluginManager.trigger('onTitleBarRegister', this.titleBarConfig);

        const titleBar = UIElementCreator.createDiv({ className: 'title-bar' });

        // Create title element
        const titleElement = this.createTitleElement();
        titleBar.appendChild(titleElement);

        // Create button container
        const buttonContainer = UIElementCreator.createDiv({ className: 'button-container' });
        Object.values(this.titleBarConfig.buttons).forEach(buttonConfig => {
            const button = UIElementCreator.createButton(buttonConfig.label, {
                id: buttonConfig.id,
                className: buttonConfig.className,
                events: { click: buttonConfig.onClick }
            });
            buttonContainer.appendChild(button);
        });
        titleBar.appendChild(buttonContainer);

        this.topPanel.appendChild(titleBar);
    }

    /**
     * Creates the title element, which can be a simple text display or an editable input.
     * @returns {HTMLElement} The created title element.
     */
    createTitleElement() {
        if (this.titleBarConfig.isEditable) {
            const input = UIElementCreator.createInput('text', {
                id: 'chat-title-input',
                value: this.titleBarConfig.title,
                className: 'chat-title-input'
            });

            // Trigger title updated event on focus out (blur)
            input.addEventListener('blur', () => {
                this.pluginManager.trigger('onTitleChanged', { title: input.value });
            });

            // Trigger title updated event on Enter key press
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    input.blur(); // Trigger the blur event to save
                }
            });

            return input;
        } else {
            return UIElementCreator.createElement('h3', {
                id: 'chat-title',
                textContent: this.titleBarConfig.title,
                className: 'chat-title'
            });
        }
    }

    /**
     * Updates the title bar configuration and re-renders the component.
     *
     * @param {object} newConfig - The new configuration to apply.
     *   - 'title' (string): The title to display.
     *   - 'isEditable' (boolean): Whether the title should be an editable input.
     *   - 'buttons' (object): An object of button configurations to add or override.
     */
    update(newConfig) {
        if (newConfig.title !== undefined) {
            this.titleBarConfig.title = newConfig.title;
        }
        if (newConfig.isEditable !== undefined) {
            this.titleBarConfig.isEditable = newConfig.isEditable;
        }
        if (newConfig.buttons !== undefined) {
            this.titleBarConfig.buttons = { ...this.titleBarConfig.buttons, ...newConfig.buttons };
        }
        this.render();
    }
}
