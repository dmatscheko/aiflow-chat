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

/**
 * Makes a container's content editable in-place.
 * Replaces the container's content with a textarea for editing.
 * @param {HTMLElement} containerEl - The element to make editable.
 * @param {string} initialText - The initial text to populate the editor with.
 * @param {(newText: string) => void} onSave - Callback to execute when saving.
 * @param {() => void} [onCancel] - Optional callback to execute on cancellation.
 */
/**
 * Makes a container's content editable in-place using a single-line input.
 * Replaces the container's content with an input field for editing.
 * Saves on Enter or blur, cancels on Escape.
 * @param {HTMLElement} containerEl - The element to make editable.
 * @param {string} initialText - The initial text to populate the editor with.
 * @param {(newText: string) => void} onSave - Callback to execute when saving.
 * @param {() => void} [onCancel] - Optional callback to execute on cancellation.
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
 * Makes a container's content editable in-place with a multi-line textarea.
 * Replaces the container's content with a textarea and Save/Cancel buttons.
 * Saves on button click or Enter, cancels on button click or Escape.
 * @param {HTMLElement} containerEl - The element to make editable.
 * @param {string} initialText - The initial text to populate the editor with.
 * @param {(newText: string) => void} onSave - Callback to execute when saving.
 * @param {() => void} [onCancel] - Optional callback to execute on cancellation.
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
        if (e.key === 'Enter' && !e.shiftKey) {
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
 * Generates a unique name from a base name by appending a number in parentheses if needed.
 * e.g., "New Flow" -> "New Flow (2)"
 * @param {string} baseName The desired base name.
 * @param {string[]} existingNames A list of names that already exist.
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
