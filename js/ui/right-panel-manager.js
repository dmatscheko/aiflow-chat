
import { UIElementCreator } from './ui-elements.js';

/**
 * Manages the right-hand panel of the application, including its tabs and content panes.
 */
export class RightPanelManager {
    /**
     * @param {PluginManager} pluginManager - The application's plugin manager.
     */
    constructor(pluginManager) {
        this.pluginManager = pluginManager;
        this.tabs = {}; // Stores tab configurations
        this.tabButtons = {}; // Stores tab button elements
        this.tabPanes = {}; // Stores tab pane elements
        this.activeTabId = null;
        this.isReady = false; // Flag to ensure the panel renders only once

        // Get DOM elements
        this.rightPanel = document.getElementById('right-panel');
        this.tabList = document.getElementById('tab-list');
        this.tabContent = document.getElementById('tab-content');

        this.pluginManager.registerHook('onViewRendered', this.onViewRendered.bind(this));
    }

    /**
     * Registers a new tab to be displayed in the right panel.
     * This should be called by plugins during their initialization.
     *
     * @param {object} tabConfig - The configuration object for the tab.
     *   - 'id' (string): A unique identifier for the tab.
     *   - 'label' (string): The text to display on the tab button.
     *   - 'onCreate' (function): A callback that returns the HTMLElement for the tab's content pane.
     */
    registerTab(tabConfig) {
        if (this.tabs[tabConfig.id]) {
            console.warn(`Tab with id '${tabConfig.id}' is already registered.`);
            return;
        }
        this.tabs[tabConfig.id] = tabConfig;
    }

    onViewRendered() {
        if (!this.isReady) {
            this.render();
            this.isReady = true;
        }
    }

    /**
     * Renders the tab buttons and their corresponding panes.
     * This is called once the main application view is ready.
     */
    render() {
        // Clear any existing tabs
        this.tabList.innerHTML = '';
        this.tabContent.innerHTML = '';

        // Create and append tabs and panes
        Object.values(this.tabs).forEach(tabConfig => {
            // Create tab button
            const tabButton = UIElementCreator.createButton(tabConfig.label, {
                id: `tab-${tabConfig.id}`,
                className: 'tab-button',
                events: {
                    click: () => this.activateTab(tabConfig.id)
                }
            });
            this.tabButtons[tabConfig.id] = tabButton;
            this.tabList.appendChild(tabButton);

            // Create tab pane
            const tabPane = UIElementCreator.createDiv({
                id: `pane-${tabConfig.id}`,
                className: 'tab-pane'
            });
            const paneContent = tabConfig.onCreate();
            tabPane.appendChild(paneContent);

            this.tabPanes[tabConfig.id] = tabPane;
            this.tabContent.appendChild(tabPane);
        });

        // Activate the first tab by default
        const firstTabId = Object.keys(this.tabs)[0];
        if (firstTabId) {
            this.activateTab(firstTabId);
        }
    }

    /**
     * Activates a specific tab, showing its content and highlighting the button.
     *
     * @param {string} tabId - The ID of the tab to activate.
     */
    activateTab(tabId) {
        if (!this.tabs[tabId]) return;

        this.activeTabId = tabId;

        // Update tab buttons
        Object.values(this.tabButtons).forEach(button => button.classList.remove('active'));
        this.tabButtons[tabId].classList.add('active');

        // Update tab panes
        Object.values(this.tabPanes).forEach(pane => pane.style.display = 'none');
        this.tabPanes[tabId].style.display = 'block';

        this.pluginManager.trigger('onTabActivated', { tabId });
    }

    /**
     * Gets the content pane for a specific tab.
     *
     * @param {string} tabId - The ID of the tab.
     * @returns {HTMLElement|null} The content pane element, or null if not found.
     */
    getPane(tabId) {
        return this.tabPanes[tabId] ? this.tabPanes[tabId].firstElementChild : null;
    }
}
