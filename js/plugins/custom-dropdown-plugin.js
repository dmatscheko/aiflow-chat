/**
 * @fileoverview A self-contained plugin that automatically converts all native
 * `<select>` elements into custom, styleable dropdowns. This is primarily to
 * work around the poor styling support for `<select>` on mobile devices and to
 * ensure a consistent look and feel across the application.
 *
 * This script is wrapped in an Immediately-Invoked Function Expression (IIFE)
 * to avoid polluting the global scope. It runs automatically upon being loaded,
 * finds all `<select>` elements on the page, and replaces them with custom-styled
 * markup that synchronizes with the original, now-hidden, `<select>` element.
 * A `MutationObserver` is used to also handle any `<select>` elements that are
 * added to the page dynamically after the initial load.
 */

'use strict';

(function() {
  /**
   * Converts a single native `<select>` element into a custom dropdown component.
   * It hides the original select, builds a new structure with a button and a list,
   * and sets up event listeners to keep the original select's value in sync.
   * If the element has already been converted, it does nothing.
   * @param {HTMLSelectElement} select The original select element to be converted.
   */
  function convertSelect(select) {
    if (select.classList.contains("original-select")) return; // already converted

    // Defensively remove any orphaned dropdown for this select's ID
    if (select.id) {
        const orphan = document.querySelector(`.custom-dropdown[data-for-select="${select.id}"]`);
        if (orphan) {
            orphan.remove();
        }
    }

    select.classList.add("original-select");

    // Wrap label and select in a div for better layout control, if a label exists.
    if (select.id) {
        const label = document.querySelector(`label[for="${select.id}"]`);
        if (label && label.parentNode) {
            const controlWrapper = document.createElement('div');
            controlWrapper.className = 'setting__control-wrapper';
            // Insert the wrapper before the label and move the label and select inside
            label.parentNode.insertBefore(controlWrapper, label);
            controlWrapper.appendChild(label);
            controlWrapper.appendChild(select);
        }
    }

    // Create wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "custom-dropdown";
    if (select.id) {
        wrapper.dataset.forSelect = select.id;
    }

    // Create button
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dropdown-btn";
    btn.textContent = select.options[select.selectedIndex]?.text || "Select...";
    wrapper.appendChild(btn);

    // Create list
    const list = document.createElement("div");
    list.className = "dropdown-list";
    Array.from(select.options).forEach(option => {
      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.textContent = option.text;
      item.dataset.value = option.value;

      if (option.selected) {
          item.classList.add('selected');
      }

      item.addEventListener("click", () => {
        // Update selected state in custom dropdown
        list.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');

        // Update original select and fire change event
        btn.textContent = option.text;
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        list.classList.remove("show");
      });
      list.appendChild(item);
    });
    wrapper.appendChild(list);

    // --- Calculate width based on options ---
    let maxWidth = 0;
    const tempSpan = document.createElement('span');
    // Apply the same styles as the dropdown items for accurate measurement
    tempSpan.className = 'dropdown-item';
    // Position it off-screen
    tempSpan.style.position = 'absolute';
    tempSpan.style.top = '-9999px';
    tempSpan.style.left = '-9999px';
    tempSpan.style.visibility = 'hidden';
    // It needs to be in the DOM to have a size
    document.body.appendChild(tempSpan);

    Array.from(select.options).forEach(option => {
        // Use innerHTML to render entities correctly, but sanitize first if needed
        tempSpan.textContent = option.text;
        if (tempSpan.scrollWidth > maxWidth) {
            maxWidth = tempSpan.scrollWidth;
        }
    });

    document.body.removeChild(tempSpan);

    // Set the wrapper's min-width. The button is 100% of the wrapper.
    wrapper.style.minWidth = `${maxWidth + 10}px`;


    // Toggle open/close
    btn.addEventListener("click", (e) => {
        e.stopPropagation(); // Stop click from bubbling to document
        // Close other dropdowns
        document.querySelectorAll('.custom-dropdown .dropdown-list.show').forEach(l => {
            if (l !== list) {
                l.classList.remove('show');
            }
        });
        list.classList.toggle("show");
    });


    // Insert into DOM and hide original select
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select); // Move original select into wrapper
  }

  // A global click listener to close any open dropdowns when the user clicks elsewhere.
  document.addEventListener("click", () => {
      document.querySelectorAll('.custom-dropdown .dropdown-list.show').forEach(list => {
        list.classList.remove("show");
      });
  });


  /**
   * Initializes the custom dropdown functionality. It performs an initial conversion
   * of all `<select>` elements currently in the DOM and then sets up a
   * `MutationObserver` to automatically convert any `<select>` elements that are
   * dynamically added later. It also handles reconversion if an existing
   * select's options are modified.
   */
  function init() {
    // Convert all selects on page
    document.querySelectorAll("select").forEach(convertSelect);

    // Watch for new selects being added or options changing in existing ones
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        // Case 1: A new <select> element is added to the DOM
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) { // ELEMENT_NODE
            if (node.tagName === "SELECT") {
              convertSelect(node);
            } else if (node.querySelectorAll) {
              node.querySelectorAll("select").forEach(convertSelect);
            }
          }
        }

        // Case 2: The options of a converted <select> have changed
        if (m.type === 'childList' && m.target.tagName === 'SELECT' && m.target.classList.contains('original-select')) {
            const select = m.target;
            const customDropdownWrapper = select.closest('.custom-dropdown');
            if (customDropdownWrapper && customDropdownWrapper.parentNode) {
                // The select is inside the custom dropdown. Move it out before removing the wrapper.
                customDropdownWrapper.parentNode.insertBefore(select, customDropdownWrapper);
                customDropdownWrapper.remove();

                // Re-run the conversion. First, remove the class so the guard clause passes.
                select.classList.remove('original-select');
                convertSelect(select);
            }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Since this script is loaded as a module and main.js waits for DOMContentLoaded,
  // we can reasonably expect the body to be present.
  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

})();
