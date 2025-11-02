/**
 * @fileoverview A plugin that converts standard <select> elements into
 * searchable and styleable custom dropdowns. This enhances usability for long
 * lists of options. The plugin automatically activates for all single-choice
 * <select> elements found on the page after a view is rendered.
 * @version 1.2.0
 */

'use strict';
import { pluginManager } from '../plugin-manager.js';

/**
 * Scans the DOM for undecorated <select> elements and initializes the
 * custom dropdown functionality on them. It avoids re-initializing elements
 * that have already been processed.
 */
function initializeCustomDropdowns() {
    document.querySelectorAll('select:not([multiple])').forEach(select => {
        // Check a data attribute to prevent re-initialization
        if (select.dataset.customDropdownInitialized) {
            return;
        }
        createCustomDropdown(select);
    });
}

pluginManager.register({
    name: 'Custom Dropdowns',
    /**
     * Exposes the initialization function globally so other plugins can call it
     * after creating dynamic content.
     */
    onAppInit(app) {
        // Ensure a global namespace for our plugin exists
        app.customDropdowns = app.customDropdowns || {};
        app.customDropdowns.init = initializeCustomDropdowns;
    },
    /**
     * Initializes dropdowns for the main view when it's first rendered.
     */
    onAfterViewRendered(view) {
        initializeCustomDropdowns();
    }
});


/**
 * Creates and manages a custom dropdown element that replaces a standard <select>.
 * @param {HTMLSelectElement} selectElement The original <select> element to replace.
 */
function createCustomDropdown(selectElement) {
    // Mark as initialized to prevent redundant setup
    selectElement.dataset.customDropdownInitialized = 'true';

    // Create main container
    const container = document.createElement('div');
    container.className = 'custom-dropdown-container';

    // Create the button that shows the selected value and toggles the dropdown
    const button = document.createElement('button');
    button.className = 'custom-dropdown-button';
    button.type = 'button'; // Prevent form submission
    button.innerHTML = `<span class="custom-dropdown-value"></span><i class="icon arrow-down"></i>`;

    // Create the panel that holds the search box and options
    const dropdownPanel = document.createElement('div');
    dropdownPanel.className = 'custom-dropdown-panel';

    // Create a search input for filtering options
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'custom-dropdown-search';
    searchInput.placeholder = 'Search...';
    dropdownPanel.appendChild(searchInput);

    // Create the list that will hold the dropdown items
    const dropdownList = document.createElement('div');
    dropdownList.className = 'custom-dropdown-list';
    dropdownPanel.appendChild(dropdownList);

    container.appendChild(button);
    container.appendChild(dropdownPanel);

    // Replace the original select element with the new custom dropdown
    selectElement.style.display = 'none';
    selectElement.parentNode.insertBefore(container, selectElement.nextSibling);

    const valueElement = button.querySelector('.custom-dropdown-value');

    /**
     * Synchronizes the custom dropdown's UI with the state of the original
     * <select> element (its options and selected value).
     */
    function syncCustomDropdown() {
        dropdownList.innerHTML = '';
        const selectedOption = selectElement.querySelector('option:checked');

        // Update the button text to the selected option, or a placeholder
        if (selectedOption) {
            valueElement.textContent = selectedOption.textContent;
            valueElement.dataset.value = selectedOption.value;
        } else {
            valueElement.textContent = selectElement.getAttribute('placeholder') || 'Select an option';
            valueElement.dataset.value = '';
        }

        // Create a list item for each option in the original select
        selectElement.querySelectorAll('option').forEach(option => {
            const item = document.createElement('div');
            item.className = 'custom-dropdown-item';
            item.textContent = option.textContent;
            item.dataset.value = option.value;

            if (option.selected) {
                item.classList.add('selected');
            }

            // Handle clicks on an item
            item.addEventListener('click', () => {
                selectElement.value = option.value;
                const changeEvent = new Event('change', { bubbles: true });
                selectElement.dispatchEvent(changeEvent);
                syncCustomDropdown();
                closeDropdown();
            });
            dropdownList.appendChild(item);
        });
    }

    /** Toggles the visibility of the dropdown panel. */
    function toggleDropdown() {
        container.classList.toggle('open');
    }

    /** Closes the dropdown panel. */
    function closeDropdown() {
        container.classList.remove('open');
    }

    // Initial population of the custom dropdown
    syncCustomDropdown();

    // Event listener to toggle the dropdown when the button is clicked
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    // Event listener for the search input to filter options
    searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase();
        dropdownList.querySelectorAll('.custom-dropdown-item').forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(searchTerm) ? '' : 'none';
        });
    });

    // Use MutationObserver to watch for changes in the original select element
    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            // Re-sync if options are added/removed or attributes change
            if (mutation.type === 'childList' || mutation.type === 'attributes') {
                syncCustomDropdown();
            }
        }
    });

    observer.observe(selectElement, {
        childList: true,
        attributes: true,
        subtree: true // For changes on option elements
    });

    // Close the dropdown if a click occurs outside of it
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            closeDropdown();
        }
    });
}
