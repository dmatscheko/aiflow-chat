/**
 * @fileoverview A generic data manager for handling CRUD operations and
 * persistence for different types of entities (e.g., chats, agents, flows).
 */

'use strict';

import { generateUniqueId, ensureUniqueId } from './utils.js';

/**
 * A generic class to manage CRUD operations for a list of items,
 * with persistence to localStorage.
 * @class
 * @template T The type of object being managed by this data manager.
 */
export class DataManager {
    /**
     * Creates an instance of DataManager.
     * @constructor
     * @param {string} storageKey The key to use for storing data in localStorage.
     * @param {string} entityName The singular name of the entity being managed (e.g., 'chat', 'agent'), used for generating unique IDs.
     * @param {Function|null} [onDataLoaded=null] An optional callback function to process the raw data after it's loaded from localStorage. This is useful for reconstructing class instances from plain objects.
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
     * Loads items from localStorage, applying the `onDataLoaded` callback if it exists.
     * This method is called automatically by the constructor.
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
     * Saves the current items to localStorage. If items have a `toJSON` method,
     * it will be called before serialization.
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
     * Retrieves all items managed by this instance.
     * @returns {T[]} An array of all items.
     */
    getAll() {
        return this.items;
    }

    /**
     * Retrieves a single item by its unique identifier.
     * @param {string} id The ID of the item to retrieve.
     * @returns {T|undefined} The found item, or `undefined` if no item with the given ID exists.
     */
    get(id) {
        return this.items.find(item => item.id === id);
    }

    /**
     * Adds a new item, automatically generating a unique ID for it.
     * @param {object} itemData The data for the new item. An `id` property will be added.
     * @returns {T} The newly created item, including its generated ID.
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
     * Adds an item from an external data source (e.g., an import).
     * It ensures the item's ID is unique within the current collection,
     * generating a new one if a conflict is found.
     * @param {object} itemData The item data to import. It should ideally have an `id`.
     * @returns {T} The added item with a guaranteed unique ID.
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
     * Updates an existing item identified by its ID.
     * @param {object} itemData The item data to update. This object must include the `id` of the item to be updated.
     */
    update(itemData) {
        const index = this.items.findIndex(item => item.id === itemData.id);
        if (index !== -1) {
            this.items[index] = { ...this.items[index], ...itemData };
            this.save();
        }
    }

    /**
     * Deletes an item from the collection by its ID.
     * @param {string} id The ID of the item to delete.
     */
    delete(id) {
        const index = this.items.findIndex(item => item.id === id);
        if (index > -1) {
            this.items.splice(index, 1);
            this.save();
        }
    }
}