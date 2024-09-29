import * as vscode from 'vscode';

let panel: vscode.WebviewPanel | undefined = undefined;
let conversationHistory: { role: string; content: string }[] = [];

export function activate(context: vscode.ExtensionContext) {
    console.log("Comment Translate & Chat with Claude is now active!");

    // コメント翻訳機能のためのHover Provider
    const hoverProvider = vscode.languages.registerHoverProvider("*", {
        provideHover: async (document, position, token) => {
            const range = document.getWordRangeAtPosition(position);
            if (!range) {return;}

            const text = document.getText(range);
            if (!isComment(document, position)) {return;}

            try {
                const translatedText = await translateUsingClaudeAPI(text);
                return new vscode.Hover(new vscode.MarkdownString(translatedText));
            } catch (error) {
                console.error("Translation failed:", error);
                return new vscode.Hover("Translation failed");
            }
        }
    });

    // チャット機能を開くコマンド
    let chatDisposable = vscode.commands.registerCommand('commentTranslateClaude.openChat', () => {
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
        } else {
            panel = vscode.window.createWebviewPanel(
                'claudeChat',
                'Claude Chat',
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            panel.webview.html = getWebviewContent();

            panel.webview.onDidReceiveMessage(
                message => {
                    switch (message.command) {
                        case 'sendMessage':
                            sendMessageToClaude(message.text).then(response => {
                                panel?.webview.postMessage({ command: 'receiveMessage', text: response });
                            }).catch(error => {
                                vscode.window.showErrorMessage(`Error: ${error.message}`);
                                panel?.webview.postMessage({ command: 'receiveMessage', text: `Error: ${error.message}` });
                            });
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );

            panel.onDidDispose(
                () => {
                    panel = undefined;
                },
                null,
                context.subscriptions
            );
        }
    });

    context.subscriptions.push(hoverProvider, chatDisposable);
}

function isComment(document: vscode.TextDocument, position: vscode.Position): boolean {
    const line = document.lineAt(position.line).text;
    return line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*');
}

interface ClaudeAPIResponse {
    id: string;
    type: string;
    role: string;
    content: Array<{type: string; text: string}>;
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

function isValidClaudeAPIResponse(data: unknown): data is ClaudeAPIResponse {
    return (
        typeof data === 'object' &&
        data !== null &&
        'id' in data &&
        'type' in data &&
        'role' in data &&
        'content' in data &&
        Array.isArray((data as any).content) &&
        'model' in data &&
        'stop_reason' in data &&
        'stop_sequence' in data &&
        'usage' in data &&
        typeof (data as any).usage === 'object' &&
        'input_tokens' in (data as any).usage &&
        'output_tokens' in (data as any).usage
    );
}

async function translateUsingClaudeAPI(text: string): Promise<string> {
    const apiKey = getApiKey();

    if (!apiKey) {
        throw new Error("Claude API key is not set. Please set it in the extension settings.");
    }

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: "claude-3-5-sonnet-20240620",
                max_tokens: 8192,
                messages: [
                    { role: "user", content: `Translate the following text to Japanese: ${text}` }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const rawData: unknown = await response.json();
        if (!isValidClaudeAPIResponse(rawData)) {
            throw new Error("Invalid response data from Claude API");
        }

        return rawData.content[0].text;
    } catch (error) {
        console.error("Error calling Claude API:", error);
        throw new Error("Failed to translate using Claude API");
    }
}

async function sendMessageToClaude(text: string): Promise<string> {
    const apiKey = getApiKey();

    if (!apiKey) {
        throw new Error("Claude API key is not set. Please set it in the extension settings.");
    }

    conversationHistory.push({ role: "user", content: text });

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: "claude-3-sonnet-20240229",
                max_tokens: 1000,
                messages: conversationHistory
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const rawData: unknown = await response.json();
        if (!isValidClaudeAPIResponse(rawData)) {
            throw new Error("Invalid response data from Claude API");
        }

        const assistantResponse = rawData.content[0].text;

        conversationHistory.push({ role: "assistant", content: assistantResponse });

        if (conversationHistory.length > 20) {
            conversationHistory = conversationHistory.slice(-20);
        }

        return assistantResponse;
    } catch (error) {
        console.error("Error calling Claude API:", error);
        throw new Error("Failed to communicate with Claude API");
    }
}

function getApiKey(): string {
    return vscode.workspace.getConfiguration("commentTranslateClaude").get("apiKey") || "";
}

function getWebviewContent() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Claude Chat</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 10px; display: flex; flex-direction: column; height: 100vh; }
            #chat-container { flex-grow: 1; overflow-y: auto; margin-bottom: 10px; }
            #input-container { display: flex; }
            #user-input { flex-grow: 1; margin-right: 10px; }
        </style>
    </head>
    <body>
        <div id="chat-container"></div>
        <div id="input-container">
            <input type="text" id="user-input" />
            <button onclick="sendMessage()">Send</button>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const userInput = document.getElementById('user-input');

            function sendMessage() {
                const message = userInput.value;
                if (message) {
                    appendMessage('You: ' + message);
                    vscode.postMessage({ command: 'sendMessage', text: message });
                    userInput.value = '';
                }
            }

            function appendMessage(message) {
                const messageElement = document.createElement('div');
                messageElement.textContent = message;
                chatContainer.appendChild(messageElement);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'receiveMessage':
                        appendMessage('Claude: ' + message.text);
                        break;
                }
            });

            userInput.addEventListener('keypress', function(event) {
                if (event.key === 'Enter') {
                    sendMessage();
                }
            });
        </script>
    </body>
    </html>`;
}

export function deactivate() {}
export { isComment, translateUsingClaudeAPI, sendMessageToClaude };