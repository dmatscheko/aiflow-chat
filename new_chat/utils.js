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
 * Creates a JSON file from the given data and triggers a download.
 * @param {object|Array} data - The JSON data to export.
 * @param {string} filenameBase - The base name for the downloaded file.
 * @param {string} extension - The file extension (e.g., 'chat', 'flow').
 */
export function exportJson(data, filenameBase, extension) {
    if (!data) {
        console.error('No data to export.');
        return;
    }

    try {
        const jsonData = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filenameBase}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error(`Failed to export data: ${error.message}`);
    }
}

/**
 * Creates a file input to import a JSON file and processes its content.
 * @param {string} extension - The file extension to accept (e.g., '.chat').
 * @param {function(object): void} onParsedData - The callback to handle the parsed data.
 */
export function importJson(extension, onParsedData) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extension;
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsedData = JSON.parse(event.target.result);
                onParsedData(parsedData);
            } catch (error) {
                console.error(`Failed to import file: ${error.message}`);
                alert(`Error: Could not parse the file. Please ensure it is a valid .${extension} file.`);
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

/**
 * Generates a unique ID with a given prefix.
 * If the initial ID conflicts with an existing one, it appends a random suffix.
 * @param {string} prefix - The prefix for the ID (e.g., 'agent', 'chat').
 * @param {Set<string>} existingIds - A set of already existing IDs to check against for uniqueness.
 * @returns {string} A new, unique ID.
 */
export function generateUniqueId(prefix, existingIds) {
    let id = `${prefix}-${Date.now()}`;
    while (existingIds.has(id)) {
        id = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }
    return id;
}

/**
 * Ensures that a given ID is unique within a set of existing IDs.
 * If the proposed ID is missing or already exists, it generates a new unique ID.
 * @param {string | null | undefined} proposedId - The ID to check for uniqueness.
 * @param {string} prefix - The prefix to use if a new ID needs to be generated (e.g., 'agent').
 * @param {Set<string>} existingIds - A set of already existing IDs.
 * @returns {string} The original ID if it was unique, or a newly generated unique ID.
 */
export function ensureUniqueId(proposedId, prefix, existingIds) {
    if (!proposedId || existingIds.has(proposedId)) {
        const newId = generateUniqueId(prefix, existingIds);
        console.log(`ID "${proposedId}" conflicted or was missing. Assigned new ID: "${newId}"`);
        return newId;
    }
    return proposedId;
}
