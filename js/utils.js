/**
 * @fileoverview A collection of shared utility functions used across the application.
 * This module includes helpers for DOM manipulation, data handling (import/export),
 * event debouncing, and generating unique identifiers.
 */

'use strict';

/**
 * Returns a function that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * `wait` milliseconds. This is useful for delaying the execution of a function
 * until after a burst of events has ended (e.g., resizing a window, typing in a search box).
 * @param {Function} func The function to debounce.
 * @param {number} wait The number of milliseconds to delay after the last invocation.
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
 * Creates a JSON file from the given data object and triggers a browser download.
 * @param {object|Array} data The JSON-serializable data to export.
 * @param {string} filenameBase The base name for the downloaded file (without extension).
 * @param {string} extension The file extension to use (e.g., 'chat', 'flow').
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
 * Opens a file dialog for the user to select a JSON file, then reads and parses it.
 * @param {string} extension The file extension to accept (e.g., '.chat'), including the dot.
 * @param {(parsedData: object) => void} onParsedData The callback function to handle the successfully parsed JSON data.
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
 * Generates a unique ID with a given prefix, ensuring it does not conflict with existing IDs.
 * If the initial timestamp-based ID conflicts, it appends a random suffix until it is unique.
 * @param {string} prefix The prefix for the ID (e.g., 'agent', 'chat').
 * @param {Set<string>} existingIds A `Set` of already existing IDs to check against for uniqueness.
 * @returns {string} A new, unique ID (e.g., 'chat-1678886400000').
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
 * If the proposed ID is null, undefined, or already exists in the set, it generates a new unique ID.
 * Otherwise, it returns the proposed ID.
 * @param {string | null | undefined} proposedId The ID to check for uniqueness.
 * @param {string} prefix The prefix to use if a new ID needs to be generated (e.g., 'agent').
 * @param {Set<string>} existingIds A `Set` of already existing IDs.
 * @returns {string} The original ID if it was valid and unique, or a newly generated unique ID.
 */
export function ensureUniqueId(proposedId, prefix, existingIds) {
    if (!proposedId || existingIds.has(proposedId)) {
        const newId = generateUniqueId(prefix, existingIds);
        console.log(`ID "${proposedId}" conflicted or was missing. Assigned new ID: "${newId}"`);
        return newId;
    }
    return proposedId;
}

/**
 * Makes an element's content editable in-place using a single-line input field.
 * Replaces the target element with an `<input type="text">`.
 * Saves on Enter or blur, cancels on Escape.
 * @param {HTMLElement} containerEl The element to make editable. Its display will be toggled.
 * @param {string} initialText The initial text to populate the editor with.
 * @param {(newText: string) => void} onSave Callback executed when saving the new text.
 * @param {(() => void)|null} [onCancel=null] Optional callback executed on cancellation.
 */
export function makeSingleLineEditable(containerEl, initialText, onSave, onCancel = null) {
    containerEl.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-in-place-input';
    input.value = initialText || '';

    containerEl.parentElement.insertBefore(input, containerEl);

    setTimeout(() => {
        input.focus();
        input.select();
    }, 0);

    let isSaving = false;

    const cleanup = () => {
        input.remove();
        containerEl.style.display = '';
    };

    const save = () => {
        if (isSaving) return;
        isSaving = true;
        onSave(input.value);
        cleanup();
    };

    const cancel = () => {
        if (onCancel) {
            onCancel();
        }
        cleanup();
    };

    input.addEventListener('blur', save);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
        }
    });
}

/**
 * Makes an element's content editable in-place with a multi-line textarea and Save/Cancel buttons.
 * Replaces the target element with a `<textarea>` and associated controls.
 * Saves on button click or Enter (without modifiers), cancels on button click or Escape.
 * The textarea automatically resizes to fit its content.
 * @param {HTMLElement} containerEl The element to make editable. Its display will be toggled.
 * @param {string} initialText The initial text to populate the editor with.
 * @param {(newText: string) => void} onSave Callback executed when saving the new text.
 * @param {(() => void)|null} [onCancel=null] Optional callback executed on cancellation.
 */
export function makeEditable(containerEl, initialText, onSave, onCancel = null) {
    containerEl.style.display = 'none';

    const editorContainer = document.createElement('div');
    editorContainer.className = 'edit-container';

    const textarea = document.createElement('textarea');
    textarea.className = 'edit-in-place';
    textarea.value = initialText || '';
    editorContainer.appendChild(textarea);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'edit-buttons';
    editorContainer.appendChild(buttonContainer);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.className = 'edit-save-btn';
    buttonContainer.appendChild(saveButton);

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.className = 'edit-cancel-btn';
    buttonContainer.appendChild(cancelButton);

    containerEl.parentElement.insertBefore(editorContainer, containerEl);

    setTimeout(() => {
        textarea.focus();
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }, 0);

    let isSaving = false;

    const cleanup = () => {
        editorContainer.remove();
        containerEl.style.display = '';
    };

    const save = () => {
        if (isSaving) return;
        isSaving = true;
        onSave(textarea.value);
        cleanup();
    };

    const cancel = () => {
        if (onCancel) {
            onCancel();
        }
        cleanup();
    };

    saveButton.addEventListener('click', save);
    cancelButton.addEventListener('click', cancel);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
        }
    });

    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    });
}


/**
 * Generates a unique name from a base name by appending a number if needed.
 * If `baseName` is "New Flow" and "New Flow" already exists, it will return "New Flow 2".
 * If "New Flow 2" also exists, it will return "New Flow 3", and so on.
 * @param {string} baseName The desired base name.
 * @param {string[]} existingNames An array of names that already exist.
 * @returns {string} A unique name.
 */
export function generateUniqueName(baseName, existingNames) {
    if (!existingNames.includes(baseName)) {
        return baseName;
    }
    let i = 2;
    while (existingNames.includes(`${baseName} ${i}`)) {
        i++;
    }
    return `${baseName} ${i}`;
}


export function decodeHTMLEntities(text) {
    const entityMap = {
        '&amp;': '&',
        '&apos;': '\'',
        '&#x27;': '\'',
        '&#x2F;': '/',
        '&#39;': '\'',
        '&#47;': '/',
        '&lt;': '<',
        '&gt;': '>',
        '&nbsp;': ' ',
        '&quot;': '"'
    };

    return text.replace(/&[#\w]+;/g, match => entityMap[match] || match);
}
