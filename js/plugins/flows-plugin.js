
import { DataManager } from '../data-manager.js';
import { UIElementCreator } from '../ui/ui-elements.js';
import { flowStepDefinitions } from './flows-plugin-step-definitions.js';

class Flow {
    constructor(id, name, steps = []) {
        this.id = id;
        this.name = name;
        this.steps = steps;
    }

    addStep(type) {
        const step = {
            id: `step-${Date.now()}`,
            type: type,
            ...flowStepDefinitions[type].defaults,
            connections: {}
        };
        this.steps.push(step);
        return step;
    }

    getStep(id) {
        return this.steps.find(s => s.id === id);
    }
}

class FlowsPlugin {
    constructor(pluginManager) {
        this.pluginManager = pluginManager;
        this.dataManager = new DataManager('flows', {});
        this.activeFlow = null;

        this.pluginManager.registerView('flow-editor', (id) => {
            const flowData = this.dataManager.get(id);
            const flow = new Flow(flowData.id, flowData.name, flowData.steps);
            return this.renderFlowEditor(flow);
        });
        this.pluginManager.registerHook('onStart', this.onStart.bind(this));
    }

    onStart() {
        this.app = this.pluginManager.app;
        this.app.rightPanelManager.registerTab({
            id: 'flows',
            label: 'Flows',
            onCreate: this.createFlowListPane.bind(this),
        });
    }

    onViewRendered() {
        if (this.activeFlow) {
            this.renderFlowEditor(this.activeFlow);
        }
    }

    createFlowListPane() {
        const container = UIElementCreator.createDiv({ id: 'flows-pane' });

        this.listContainer = UIElementCreator.createDiv();
        container.appendChild(this.listContainer);

        const newButton = UIElementCreator.createButton('New Flow', {
            events: { click: () => this.createNewFlow() },
        });
        container.appendChild(newButton);

        this.renderFlowList();
        return container;
    }

    renderFlowList() {
        this.listContainer.innerHTML = '';
        const flows = this.dataManager.getAll();
        Object.values(flows).forEach(flowData => {
            const flow = new Flow(flowData.id, flowData.name, flowData.steps);
            const flowItem = UIElementCreator.createDiv({
                className: 'list-item',
                textContent: flow.name,
                events: { click: () => this.setActiveFlow(flow.id) },
            });
            if (this.activeFlow && this.activeFlow.id === flow.id) {
                flowItem.classList.add('active');
            }
            this.listContainer.appendChild(flowItem);
        });
    }

    setActiveFlow(id) {
        const flowData = this.dataManager.get(id);
        this.activeFlow = new Flow(flowData.id, flowData.name, flowData.steps);
        this.renderFlowList();
        this.app.setView('flow-editor', id);
    }

    createNewFlow() {
        const newFlow = { id: `flow-${Date.now()}`, name: 'New Flow', steps: [] };
        this.dataManager.add(newFlow.id, newFlow);
        this.renderFlowList();
        this.setActiveFlow(newFlow.id);
    }

    renderFlowEditor(flow) {
        const container = UIElementCreator.createDiv({ id: 'flow-editor-container' });

        const canvasWrapper = UIElementCreator.createDiv({ id: 'flow-canvas-wrapper' });
        container.appendChild(canvasWrapper);

        const canvas = UIElementCreator.createDiv({ id: 'flow-canvas' });
        canvasWrapper.appendChild(canvas);

        const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgLayer.id = 'flow-svg-layer';
        canvas.appendChild(svgLayer);

        const nodeContainer = UIElementCreator.createDiv({ id: 'flow-node-container' });
        canvas.appendChild(nodeContainer);

        this.renderFlow(flow, nodeContainer, svgLayer);

        const addStepButton = UIElementCreator.createButton('Add Step', {
            events: {
                click: () => {
                    const stepType = prompt('Enter step type:', 'simple-prompt');
                    if (stepType && flowStepDefinitions[stepType]) {
                        flow.addStep(stepType);
                        this.dataManager.update(flow.id, flow);
                        this.renderFlow(flow, nodeContainer, svgLayer);
                    }
                }
            }
        });
        container.appendChild(addStepButton);

        return container;
    }

    renderFlow(flow, nodeContainer, svgLayer) {
        nodeContainer.innerHTML = '';
        svgLayer.innerHTML = '';

        flow.steps.forEach(step => {
            const stepDef = flowStepDefinitions[step.type];
            const card = UIElementCreator.createDiv({
                className: 'flow-step-card',
                id: step.id,
                style: { left: `${step.position?.x || 50}px`, top: `${step.position?.y || 50}px` }
            });

            const title = UIElementCreator.createElement('h4', { textContent: stepDef.title });
            card.appendChild(title);

            const content = stepDef.render(step, (field, value) => {
                step[field] = value;
                this.dataManager.update(flow.id, flow);
            });
            card.appendChild(content);

            nodeContainer.appendChild(card);
        });
    }
}

export { FlowsPlugin };
