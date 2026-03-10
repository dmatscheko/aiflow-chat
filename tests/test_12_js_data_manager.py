"""Tests for js/data-manager.js - DataManager class."""

from playwright.sync_api import expect


def test_js_data_manager(page):
    errors = page.evaluate("""() => {
        const errors = [];
        function assert(condition, msg) {
            if (!condition) errors.push('FAIL: ' + msg);
        }

        // We need to test DataManager in isolation, so we import it
        // The module is already loaded via the app

        // --- Setup: clear test storage ---
        const testKey = '_test_data_manager_' + Date.now();
        localStorage.removeItem(testKey);

        // We can't directly import, but we can create a DataManager via the app's modules
        // DataManager is used by chatManager, flowManager, agentManager
        // Let's test through a fresh instance by using the constructor pattern

        // Access DataManager constructor from an existing instance
        const DataManagerClass = window.app.chatManager.dataManager.constructor;

        // --- Test: constructor creates empty items when no data in localStorage ---
        const dm = new DataManagerClass(testKey, 'test-entity');
        assert(Array.isArray(dm.getAll()), 'getAll returns an array');
        assert(dm.getAll().length === 0, 'new DataManager has empty items');

        // --- Test: add generates unique ID and saves ---
        const item1 = dm.add({ name: 'Item 1', value: 42 });
        assert(item1.id, 'add should generate an id');
        assert(item1.id.startsWith('test-entity-'), 'id should start with entity prefix');
        assert(item1.name === 'Item 1', 'add preserves data properties');
        assert(item1.value === 42, 'add preserves numeric values');
        assert(dm.getAll().length === 1, 'after add, items count is 1');

        // --- Test: add second item ---
        const item2 = dm.add({ name: 'Item 2' });
        assert(dm.getAll().length === 2, 'after second add, items count is 2');
        assert(item1.id !== item2.id, 'each item gets a unique id');

        // --- Test: get by id ---
        const found = dm.get(item1.id);
        assert(found, 'get returns the item');
        assert(found.name === 'Item 1', 'get returns correct item');
        assert(dm.get('nonexistent') === undefined, 'get returns undefined for unknown id');

        // --- Test: update ---
        dm.update({ id: item1.id, name: 'Updated Item 1', newProp: 'hello' });
        const updated = dm.get(item1.id);
        assert(updated.name === 'Updated Item 1', 'update changes existing properties');
        assert(updated.newProp === 'hello', 'update adds new properties');
        assert(updated.value === 42, 'update preserves unmodified properties (shallow merge)');

        // --- Test: update nonexistent item does nothing ---
        const countBefore = dm.getAll().length;
        dm.update({ id: 'nonexistent', name: 'ghost' });
        assert(dm.getAll().length === countBefore, 'update of nonexistent item does not add it');

        // --- Test: delete ---
        dm.delete(item2.id);
        assert(dm.getAll().length === 1, 'delete removes the item');
        assert(dm.get(item2.id) === undefined, 'deleted item is no longer findable');

        // --- Test: delete nonexistent does nothing ---
        dm.delete('nonexistent');
        assert(dm.getAll().length === 1, 'delete of nonexistent item is a no-op');

        // --- Test: persistence to localStorage ---
        const stored = JSON.parse(localStorage.getItem(testKey));
        assert(Array.isArray(stored), 'data is saved as array in localStorage');
        assert(stored.length === 1, 'localStorage has correct item count');
        assert(stored[0].name === 'Updated Item 1', 'localStorage has correct data');

        // --- Test: loading from localStorage ---
        const dm2 = new DataManagerClass(testKey, 'test-entity');
        assert(dm2.getAll().length === 1, 'new DataManager loads from localStorage');
        assert(dm2.getAll()[0].name === 'Updated Item 1', 'loaded data matches');

        // --- Test: addFromData with existing id ---
        const imported = dm.addFromData({ id: 'custom-id', name: 'Imported' });
        assert(imported.id === 'custom-id', 'addFromData preserves unique id');
        assert(imported.name === 'Imported', 'addFromData preserves data');
        assert(dm.getAll().length === 2, 'addFromData adds to collection');

        // --- Test: addFromData with conflicting id ---
        const conflicting = dm.addFromData({ id: 'custom-id', name: 'Conflict' });
        assert(conflicting.id !== 'custom-id', 'addFromData generates new id on conflict');
        assert(conflicting.name === 'Conflict', 'conflicting import preserves data');
        assert(dm.getAll().length === 3, 'conflicting import still adds item');

        // --- Test: addFromData with null/invalid data ---
        const invalid = dm.addFromData(null);
        assert(invalid === undefined, 'addFromData with null returns undefined');
        assert(dm.getAll().length === 3, 'null import does not add item');

        // --- Test: addFromData with no id ---
        const noId = dm.addFromData({ name: 'No ID' });
        assert(noId.id, 'addFromData generates id when none provided');
        assert(noId.id.startsWith('test-entity-'), 'generated id has correct prefix');

        // --- Test: onDataLoaded callback ---
        localStorage.setItem(testKey + '_cb', JSON.stringify([
            { id: 'a', value: 1 },
            { id: 'b', value: 2 },
        ]));
        const dm3 = new DataManagerClass(testKey + '_cb', 'test', (data) => {
            return data.map(item => ({ ...item, transformed: true }));
        });
        assert(dm3.getAll().length === 2, 'onDataLoaded processes all items');
        assert(dm3.getAll()[0].transformed === true, 'onDataLoaded callback is applied');
        assert(dm3.getAll()[0].value === 1, 'onDataLoaded preserves original data');

        // --- Test: corrupted localStorage data ---
        localStorage.setItem(testKey + '_bad', 'not valid json!!!');
        const dm4 = new DataManagerClass(testKey + '_bad', 'test');
        assert(dm4.getAll().length === 0, 'corrupted localStorage results in empty items');

        // Cleanup
        localStorage.removeItem(testKey);
        localStorage.removeItem(testKey + '_cb');
        localStorage.removeItem(testKey + '_bad');

        return errors;
    }""")

    assert errors == [], f"JS DataManager tests failed:\\n" + "\\n".join(errors)
