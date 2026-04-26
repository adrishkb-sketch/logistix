
/**
 * LOGISTIX CUSTOM LAYOUT ENGINE
 * Handles drag-and-drop rearrangement and persistence in localStorage.
 */

window.logistixLayout = {
    isEditMode: false,
    pageId: '',

    init(pageId) {
        this.pageId = pageId;
        this.loadLayout();
        this.setupDragAndDrop();
    },

    toggleEditMode() {
        this.isEditMode = !this.isEditMode;
        document.body.classList.toggle('edit-mode', this.isEditMode);
        
        const btn = document.getElementById('modify-dash-btn');
        if (btn) {
            btn.innerHTML = this.isEditMode ? `💾 ${getTranslation('btn_save_layout')}` : `📐 ${getTranslation('modify_dashboard')}`;
            btn.classList.toggle('btn-success', this.isEditMode);
        }


        if (!this.isEditMode) {
            this.saveLayout();
        }

        // Toggle draggability on marked elements
        const draggables = document.querySelectorAll('[data-layout-id]');
        draggables.forEach(el => {
            el.draggable = this.isEditMode;
            if (this.isEditMode) {
                el.classList.add('draggable-item');
            } else {
                el.classList.remove('draggable-item');
            }
        });
    },

    setupDragAndDrop() {
        let draggedItem = null;

        document.addEventListener('dragstart', (e) => {
            if (!this.isEditMode) return;
            if (!e.target.hasAttribute('data-layout-id')) return;

            draggedItem = e.target;
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        document.addEventListener('dragend', (e) => {
            if (draggedItem) {
                draggedItem.classList.remove('dragging');
                draggedItem = null;
            }
            // Remove over classes from everyone
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });

        document.addEventListener('dragover', (e) => {
            if (!this.isEditMode) return;
            e.preventDefault();
            const target = e.target.closest('[data-layout-id]');
            if (target && target !== draggedItem && target.parentNode === draggedItem.parentNode) {
                target.classList.add('drag-over');
            }
        });

        document.addEventListener('dragleave', (e) => {
            const target = e.target.closest('[data-layout-id]');
            if (target) target.classList.remove('drag-over');
        });

        document.addEventListener('drop', (e) => {
            if (!this.isEditMode) return;
            e.preventDefault();
            const target = e.target.closest('[data-layout-id]');
            
            if (target && draggedItem && target !== draggedItem && target.parentNode === draggedItem.parentNode) {
                const parent = target.parentNode;
                const items = [...parent.querySelectorAll(':scope > [data-layout-id]')];
                const draggedIndex = items.indexOf(draggedItem);
                const targetIndex = items.indexOf(target);

                if (draggedIndex < targetIndex) {
                    parent.insertBefore(draggedItem, target.nextSibling);
                } else {
                    parent.insertBefore(draggedItem, target);
                }
            }
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
    },

    saveLayout() {
        const layout = {};
        const containers = document.querySelectorAll('[data-layout-container]');
        
        containers.forEach(container => {
            const containerId = container.getAttribute('data-layout-container');
            const items = [...container.querySelectorAll(':scope > [data-layout-id]')];
            layout[containerId] = items.map(item => item.getAttribute('data-layout-id'));
        });

        localStorage.setItem(`logistix_layout_${this.pageId}`, JSON.stringify(layout));
        console.log(`Layout saved for ${this.pageId}`);
    },

    loadLayout() {
        const saved = localStorage.getItem(`logistix_layout_${this.pageId}`);
        if (!saved) return;

        try {
            const layout = JSON.parse(saved);
            Object.keys(layout).forEach(containerId => {
                const container = document.querySelector(`[data-layout-container="${containerId}"]`);
                if (!container) return;

                const itemIds = layout[containerId];
                const fragment = document.createDocumentFragment();
                const currentItems = {};
                
                container.querySelectorAll(':scope > [data-layout-id]').forEach(item => {
                    currentItems[item.getAttribute('data-layout-id')] = item;
                });

                itemIds.forEach(id => {
                    if (currentItems[id]) {
                        fragment.appendChild(currentItems[id]);
                        delete currentItems[id];
                    }
                });

                // Append any remaining items that weren't in the saved layout
                Object.values(currentItems).forEach(item => fragment.appendChild(item));
                
                container.appendChild(fragment);
            });
        } catch (e) {
            console.error("Failed to load layout", e);
        }
    }
};
