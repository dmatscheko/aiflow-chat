/**
 * @fileoverview Plugin to automatically convert all native select elements
 * into custom, styleable dropdowns. This is to work around the poor styling
 * support for <select> on mobile devices.
 *
 * This script is self-contained and runs automatically. It finds all <select>
 * elements on the page, hides them, and replaces them with a custom-styled
 * dropdown that syncs with the original element. It uses a MutationObserver
 * to also handle any <select> elements that are added to the page dynamically.
 */

'use strict';

(function() {
  /**
   * Converts a single <select> element into a custom dropdown.
   * If the element has already been converted, it does nothing.
   * @param {HTMLSelectElement} select The original select element.
   */
  function convertSelect(select) {
    if (select.classList.contains("original-select")) return; // already converted
    select.classList.add("original-select");

    // Create wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "custom-dropdown";

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
      item.addEventListener("click", () => {
        btn.textContent = option.text;
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true })); // fire change event
        list.classList.remove("show");
      });
      list.appendChild(item);
    });
    wrapper.appendChild(list);

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

  // Close dropdowns when clicking anywhere else on the page
  document.addEventListener("click", () => {
      document.querySelectorAll('.custom-dropdown .dropdown-list.show').forEach(list => {
        list.classList.remove("show");
      });
  });


  /**
   * Initializes the conversion for existing and future select elements.
   */
  function init() {
    // Convert all selects on page
    document.querySelectorAll("select").forEach(convertSelect);

    // Watch for new selects being added dynamically
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) { // ELEMENT_NODE
            if (node.tagName === "SELECT") {
              convertSelect(node);
            } else {
              node.querySelectorAll?.("select").forEach(convertSelect);
            }
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
