/**
 * @fileoverview A generic data manager for handling CRUD operations and
 * persistence for different types of entities (e.g., chats, agents, flows).
 */

'use strict';

import { generateUniqueId, ensureUniqueId } from './utils.js';

/**
 * A generic class to manage CRUD operations for a list of items,
 * with persistence to localStorage.
 * @template T
 */
export class DataManager {
    /**
     * @param {string} storageKey The key to use for localStorage.
     * @param {string} entityName The name of the entity being managed (e.g., 'chat', 'agent').
     * @param {Function|null} [onDataLoaded=null] A callback to process data after it's loaded.
     */
    constructor(storageKey, entityName, onDataLoaded = null) {
        this.storageKey = storageKey;
        this.entityName = entityName;
        /** @type {T[]} */
        this.items = [];
        this.onDataLoaded = onDataLoaded;
        this._load();
    }

    /**
     * Loads items from localStorage.
     * @private
     */
    _load() {
        try {
            const jsonData = localStorage.getItem(this.storageKey);
            if (jsonData) {
                const parsedData = JSON.parse(jsonData);
                if (this.onDataLoaded) {
                    this.items = this.onDataLoaded(parsedData);
                } else {
                    this.items = parsedData;
                }
            }
        } catch (e) {
            console.error(`Failed to load ${this.entityName}s:`, e);
            this.items = [];
        }
    }

    /**
     * Saves the current items to localStorage.
     */
    save() {
        try {
            const dataToSave = this.items.map(item => (item.toJSON ? item.toJSON() : item));
            localStorage.setItem(this.storageKey, JSON.stringify(dataToSave));
        } catch (e) {
            console.error(`Failed to save ${this.entityName}s:`, e);
        }
    }

    /**
     * @returns {T[]} All items.
     */
    getAll() {
        return this.items;
    }

    /**
     * @param {string} id The ID of the item to retrieve.
     * @returns {T|undefined} The found item.
     */
    get(id) {
        return this.items.find(item => item.id === id);
    }

    /**
     * Adds a new item.
     * @param {object} itemData The data for the new item, without an ID.
     * @returns {T} The newly created item.
     */
    add(itemData) {
        const existingIds = new Set(this.items.map(item => item.id));
        const newItem = {
            ...itemData,
            id: generateUniqueId(this.entityName, existingIds),
        };
        this.items.push(newItem);
        this.save();
        return newItem;
    }

    /**
     * Adds an item from imported data, ensuring a unique ID.
     * @param {object} itemData The item data to import.
     * @returns {T} The added item.
     */
    addFromData(itemData) {
        if (!itemData || typeof itemData !== 'object') {
            console.warn(`Skipping invalid ${this.entityName} data during import:`, itemData);
            return;
        }
        const existingIds = new Set(this.items.map(item => item.id));
        const finalId = ensureUniqueId(itemData.id, this.entityName, existingIds);
        const newItem = { ...itemData, id: finalId };
        this.items.push(newItem);
        this.save();
        return newItem;
    }

    /**
     * Updates an existing item.
     * @param {object} itemData The item data to update, including its ID.
     */
    update(itemData) {
        const index = this.items.findIndex(item => item.id === itemData.id);
        if (index !== -1) {
            this.items[index] = { ...this.items[index], ...itemData };
            this.save();
        }
    }

    /**
     * Deletes an item by its ID.
     * @param {string} id The ID of the item to delete.
     */
    delete(id) {
        this.items = this.items.filter(item => item.id !== id);
        this.save();
    }
}