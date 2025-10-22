
import { DataManager } from '../data-manager.js';
import { UIElementCreator } from '../ui/ui-elements.js';

class AgentsPlugin {
    constructor(pluginManager) {
        this.pluginManager = pluginManager;
        this.dataManager = new DataManager('agents', {
            'agent-default': {
                id: 'agent-default',
                name: 'Default',
                system_prompt: 'You are a helpful assistant.',
            },
        });

        this.modelSettingDefs = {
            model: { label: 'Model', type: 'text', default: 'gpt-4' },
            temperature: { label: 'Temperature', type: 'number', min: 0, max: 2, step: 0.1, default: 1 },
            top_p: { label: 'Top P', type: 'number', min: 0, max: 1, step: 0.1, default: 1 },
            max_tokens: { label: 'Max Tokens', type: 'number', min: 1, default: 2048 },
            presence_penalty: { label: 'Presence Penalty', type: 'number', min: -2, max: 2, step: 0.1, default: 0 },
            frequency_penalty: { label: 'Frequency Penalty', type: 'number', min: -2, max: 2, step: 0.1, default: 0 },
            stop: { label: 'Stop Sequences', type: 'text', placeholder: 'e.g., ["\\n", " Human:"]', default: '' },
            use_search: { label: 'Enable Search', type: 'checkbox', default: false },
            use_pro_search: { label: 'Enable Pro Search', type: 'checkbox', default: false },
        };

        this.pluginManager.registerView('agent-editor', (id) => {
            const agent = this.dataManager.get(id);
            return this.createAgentEditor(agent);
        });
        this.pluginManager.registerHook('onStart', this.onStart.bind(this));
        this.pluginManager.registerHook('onTabActivated', this.onTabActivated.bind(this));
    }

    onStart() {
        this.app = this.pluginManager.app;
        this.app.rightPanelManager.registerTab({
            id: 'agents',
            label: 'Agents',
            onCreate: this.createAgentListPane.bind(this),
        });
    }

    onTabActivated(data) {
        if (data.tabId === 'agents' && !this.activeAgent) {
            this.setActiveAgent('agent-default');
        }
    }

    createAgentListPane() {
        const container = UIElementCreator.createDiv({ id: 'agents-pane-container' });

        const listPane = UIElementCreator.createDiv({ id: 'agents-list-pane' });
        this.listContainer = UIElementCreator.createDiv();
        listPane.appendChild(this.listContainer);

        const newButton = UIElementCreator.createButton('New Agent', {
            events: { click: () => this.createNewAgent() },
        });
        listPane.appendChild(newButton);

        container.appendChild(listPane);

        this.editorContainer = UIElementCreator.createDiv({ id: 'agent-editor-pane' });
        container.appendChild(this.editorContainer);

        this.renderAgentList();
        return container;
    }

    renderAgentList() {
        this.listContainer.innerHTML = '';
        const agents = this.dataManager.getAll();
        Object.values(agents).forEach(agent => {
            const agentItem = UIElementCreator.createDiv({
                className: 'list-item',
                textContent: agent.name,
                events: { click: () => this.setActiveAgent(agent.id) },
            });
            if (this.activeAgent && this.activeAgent.id === agent.id) {
                agentItem.classList.add('active');
            }
            this.listContainer.appendChild(agentItem);
        });
    }

    setActiveAgent(id) {
        this.activeAgent = this.dataManager.get(id);
        this.renderAgentList();
        this.app.setView('agent-editor', id);
    }

    createNewAgent() {
        const newAgent = {
            id: `agent-${Date.now()}`,
            name: 'New Agent',
            system_prompt: '',
        };
        this.dataManager.add(newAgent.id, newAgent);
        this.renderAgentList();
        this.setActiveAgent(newAgent.id);
    }

    updateAgent(id, data) {
        const agent = this.dataManager.get(id);
        if (agent) {
            Object.assign(agent, data);
            this.dataManager.update(id, agent);
            if (data.name) {
                this.renderAgentList();
            }
        }
    }

    renderAgentEditor() {
        this.editorContainer.innerHTML = '';
        if (!this.activeAgent) return;

        const agentEditor = this.createAgentEditor(this.activeAgent);
        this.editorContainer.appendChild(agentEditor);
        return this.editorContainer;
    }

    createAgentEditor(agent) {
        const container = UIElementCreator.createDiv({ id: 'agent-editor-container' });

        const nameInput = UIElementCreator.createInput('text', {
            value: agent.name,
            events: { change: (e) => this.updateAgent(agent.id, { name: e.target.value }) },
        });
        container.appendChild(nameInput);

        const systemPromptTextarea = UIElementCreator.createTextarea({
            rows: 10,
            value: agent.system_prompt,
            events: { change: (e) => this.updateAgent(agent.id, { system_prompt: e.target.value }) },
        });
        systemPromptTextarea.value = agent.system_prompt;
        container.appendChild(systemPromptTextarea);

        for (const [key, def] of Object.entries(this.modelSettingDefs)) {
            const settingDiv = UIElementCreator.createDiv();
            const label = UIElementCreator.createLabel(def.label, `agent-${key}`);
            settingDiv.appendChild(label);

            const input = UIElementCreator.createInput(def.type, {
                id: `agent-${key}`,
                ...(def.type === 'checkbox' ? { checked: agent[key] ?? def.default } : { value: agent[key] ?? def.default }),
                ...(def.min && { min: def.min }),
                ...(def.max && { max: def.max }),
                ...(def.step && { step: def.step }),
                events: {
                    change: (e) => {
                        let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
                        if (def.type === 'number') value = parseFloat(value);
                        this.updateAgent(agent.id, { [key]: value });
                    },
                },
            });
            settingDiv.appendChild(input);
            container.appendChild(settingDiv);
        }

        return container;
    }

    get(id) {
        return this.dataManager.get(id);
    }
}

export { AgentsPlugin };
