/**
 * @fileoverview Utility functions for the application.
 */

'use strict';

/**
 * Triggers a file download for the given JSON data.
 * @param {object} data The JSON object to export.
 * @param {string} filename The base name for the file.
 */
export function exportJson(data, filename) {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Opens a file picker and reads a JSON file.
 * @param {string} accept - The accept attribute for the file input.
 * @param {(data: object) => void} callback - The callback to execute with the parsed JSON data.
 */
export function importJson(accept, callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                callback(data);
            } catch (err) {
                alert(`Error parsing JSON file: ${err.message}`);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}
