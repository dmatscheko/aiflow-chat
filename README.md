# AIFlow Chat

AIFlow Chat is a versatile, open-source chat application designed for interacting with AI models through OpenAI-compatible APIs. It supports advanced features like customizable "Agents", automatable "Flows", and external "Tools" via the Model Context Protocol (MCP). It is built with vanilla JavaScript, HTML, and CSS, emphasizing a modular, plugin-based architecture for easy extension.

> **Warning**: This is a personal project developed in my spare time. While it is actively maintained, it is provided "as is" with no warranty.

## Key Features

- **Advanced AI Interactions**: Stream responses from AI models, rendering Markdown, code blocks with syntax highlighting, mathematical formulas (via KaTeX), and SVG images.
- **Customizable Agents**: Define multiple "agents," each with its own unique system prompt, API settings, and permissions. This allows you to switch between different AI personalities or configurations seamlessly.
- **Automatable Flows**: Create and execute complex, node-based workflows to automate repetitive tasks and chain multiple AI prompts together.
- **External Tool Support**: Integrate external tools (like web search or file I/O) using the Model Context Protocol (MCP), enabling the AI to interact with external systems.
- **Rich Chat Management**: Enjoy features like multiple concurrent chats, conversation branching, editing/deleting messages, and exploring alternative AI responses.
- **Extensible Plugin Architecture**: Easily add new features, UI components, or logic by creating simple JavaScript plugins that hook into the application's lifecycle.

## Architecture Overview

The application is built around a core set of managers and services, with most features being implemented as plugins. This design keeps the core clean and makes the application highly extensible.

-   **`main.js`**: The main entry point of the application. It initializes the core `App` class, which orchestrates all other components.
-   **`plugin-manager.js`**: The heart of the application's extensibility. It provides a simple publish-subscribe system where plugins can register to be notified of specific events (hooks) and modify application behavior.
-   **`chat-data.js`**: Defines the core data structures for chat history. A chat is modeled as a tree of messages, allowing for complex conversational branching and alternative responses.
-   **`api-service.js`**: A self-contained service for handling all communication with OpenAI-compatible APIs, including streaming responses.
-   **`response-processor.js`**: The engine that drives AI interactions. It manages a queue of pending AI responses, processes them, and allows plugins to intercept and act on the results (e.g., to handle a tool call).
-   **`js/plugins/`**: This directory contains all the feature-implementing plugins. Each plugin is a self-contained module that registers its functionality with the `pluginManager`.

## Getting Started

#### Online Demo
A (sometimes outdated) version is available for testing at: [https://huggingface.co/spaces/dma123/aiflow-chat](https://huggingface.co/spaces/dma123/aiflow-chat).

#### Local Development
1.  **Clone the repository**:
    `git clone https://github.com/dmatscheko/aiflow-chat.git`

2.  **Run the web server**:
    The project includes a simple Python-based server that also provides an MCP proxy for enabling tools.
    -   First, install the required Python dependencies: `pip install fastmcp fastapi uvicorn`
    -   Then, run the server from the project root: `uvicorn main:app --reload`
    -   This will start a web server at `http://localhost:8000` and an MCP proxy at `http://localhost:3000/mcp`.

3.  **Open the application**:
    Open `http://localhost:8000` in your web browser.

## Extending the Application

The most powerful feature of AIFlow Chat is its plugin system. You can add almost any new functionality by creating a simple plugin.

#### The Plugin System

The plugin system is based on **hooks**. A hook is a specific point in the application's code where plugins can inject their own logic. A plugin is simply a JavaScript object that maps hook names to functions.

When a hook is "triggered" by the application, the `pluginManager` calls all the functions that have been registered for that hook.

#### Creating a Simple Plugin

Let's create a plugin that adds a "Max Tokens" setting and includes it in API calls.

1.  **Create the plugin file**:
    Create a new file in `js/plugins/`, for example, `max-tokens-plugin.js`.

2.  **Write the plugin code**:
    ```javascript
    // js/plugins/max-tokens-plugin.js
    'use strict';
    import { pluginManager } from '../plugin-manager.js';

    const maxTokensPlugin = {
        // 1. The onSettingsRegistered hook adds our new setting to the settings UI.
        onSettingsRegistered(settings) {
            settings.push({
                id: 'maxTokens',
                label: 'Max Tokens',
                type: 'number',
                placeholder: 'e.g., 2048'
            });
            return settings; // Always return the modified settings array.
        },

        // 2. The beforeApiCall hook modifies the payload before it's sent.
        beforeApiCall(payload, allSettings) {
            if (allSettings.maxTokens && parseInt(allSettings.maxTokens, 10) > 0) {
                payload.max_tokens = parseInt(allSettings.maxTokens, 10);
            }
            return payload; // Always return the modified payload.
        }
    };

    // 3. Register the plugin with the plugin manager.
    pluginManager.register(maxTokensPlugin);
    ```

3.  **Load the plugin**:
    Add the new plugin to `main.js` so it gets loaded at startup:
    ```javascript
    // js/main.js
    // ...
    import './plugins/ui-controls-plugin.js';
    import './plugins/max-tokens-plugin.js'; // <-- Add this line
    // ...
    ```
    That's it! The "Max Tokens" setting will now appear in the settings panel, and its value will be sent with every API request.

#### Key Plugin Hooks

-   `onAppInit(app)`: Called once when the application starts. Ideal for initializing managers or registering views.
-   `onTabsRegistered(tabs)`: Allows you to add new tabs to the sidebar.
-   `onViewRendered(view, chat)`: Called after a view (like the chat or an editor) has been rendered. Perfect for adding event listeners or modifying the DOM.
-   `onSystemPromptConstruct(systemPrompt, allSettings, agent)`: Allows you to dynamically add content to an agent's system prompt before an API call.
-   `onResponseComplete(message, activeChat)`: Called after an AI response is fully received. This is where you would handle tool calls or other automated actions.
-   `onFormatMessageContent(contentEl, message)`: Allows you to transform the raw text of a message into formatted HTML (e.g., for rendering Markdown or custom syntax).
-   `onMessageRendered(el, message)`: Called after a message element has been fully rendered. Use this to add UI elements like buttons or event listeners.

## User Controls

-   **Input**: Type messages in the input box. Use `Shift+Enter` to add a new line. Press `Enter` to send.
-   **Abort**: Press `Esc` to stop a currently generating AI response.
-   **Message Controls**: Hover over a message to reveal controls for editing, deleting, or creating an alternative response.
-   **Settings**: Configure the default agent, API endpoints, and other plugin-specific settings in the `Default Agent` editor.

### Screenshot
This screenshot was "randomly selected" because its output was ok-ish ;)
![screenshot.png](screenshot.png)