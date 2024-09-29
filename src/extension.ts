import * as vscode from "vscode";

let panel: vscode.WebviewPanel | undefined = undefined;
let conversationHistory: { role: string; content: string }[] = [];

interface ClaudeAPIResponse {
	id: string;
	type: string;
	role: string;
	content: Array<{ type: string; text: string }>;
	model: string;
	stop_reason: string | null;
	stop_sequence: string | null;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

export function activate(context: vscode.ExtensionContext) {
	console.log("Comment Translate & Chat with Claude is now active!");

	const hoverProvider = vscode.languages.registerHoverProvider("*", {
		provideHover: async (document, position, token) => {
			const hover = await vscode.commands.executeCommand<vscode.Hover[]>(
				"vscode.executeHoverProvider",
				document.uri,
				position,
			);

			if (hover && hover.length > 0) {
				const originalContent = hover[0].contents
					.map((content) => {
						if (content instanceof vscode.MarkdownString) {
							return content.value;
						}
						return content.toString();
					})
					.join("\n");

				console.log("Original hover content:", originalContent);

				// ローディング表示を作成
				const loadingMarkdown = new vscode.MarkdownString("翻訳中...");
				loadingMarkdown.isTrusted = true;

				// タイムアウト処理
				const timeoutPromise = new Promise<vscode.Hover>((_, reject) => {
					setTimeout(
						() => reject(new Error("翻訳がタイムアウトしました")),
						10000,
					);
				});

				try {
					const translationPromise = translateUsingClaudeAPI(
						originalContent,
					).then((translatedText) => {
						console.log("Translated hover content:", translatedText);
						const markdown = new vscode.MarkdownString(translatedText);
						markdown.isTrusted = true;
						markdown.supportHtml = true;
						markdown.appendMarkdown("\n\n---\n\n");
						markdown.appendMarkdown(
							"[この内容について質問する](command:commentTranslateClaude.askQuestion)",
						);
						return new vscode.Hover(markdown);
					});

					// タイムアウトとの競合
					return await Promise.race([translationPromise, timeoutPromise]);
				} catch (error) {
					console.error("Translation failed:", error);
					const errorMessage = (error as Error).message;
					return new vscode.Hover(`翻訳に失敗しました: ${errorMessage}`);
				}
			}
		},
	});

	const chatDisposable = vscode.commands.registerCommand(
		"commentTranslateClaude.openChat",
		() => openChatWithContext(),
	);

	context.subscriptions.push(hoverProvider, chatDisposable);
}

async function translateUsingClaudeAPI(
	originalContent: string,
): Promise<string> {
	const apiKey = getApiKey();

	if (!apiKey) {
		console.error("API key is missing");
		throw new Error(
			"Claude API key is not set. Please set it in the extension settings.",
		);
	}

	console.log("Translating:", originalContent);

	try {
		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: "claude-3-5-sonnet-20240620",
				max_tokens: 1000,
				messages: [
					{
						role: "user",
						content: `Translate the following VS Code hover text to Japanese. Keep code and technical terms unchanged:

                        ${originalContent}

                        Japanese translation:`,
					},
				],
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(
				`API request failed with status ${response.status}:`,
				errorText,
			);
			throw new Error(`API request failed with status ${response.status}`);
		}

		const rawData: unknown = await response.json();
		console.log("Raw API response:", rawData);

		if (!isValidClaudeAPIResponse(rawData)) {
			console.error("Invalid response data:", rawData);
			throw new Error("Invalid response data from Claude API");
		}

		const translatedText = rawData.content[0].text;
		console.log("Raw translated text from API:", translatedText);

		const processedText = postProcessTranslation(translatedText);
		console.log("Processed translated text:", processedText);

		return processedText;
	} catch (error) {
		console.error("Error calling Claude API:", error);
		throw new Error(
			`Failed to translate using Claude API: ${(error as Error).message}`,
		);
	}
}

function postProcessTranslation(translation: string): string {
	console.log("Original translation before processing:", translation);

	// コードブロックを保護
	const codeBlocks: string[] = [];
	translation = translation.replace(/```[\s\S]*?```/g, (match) => {
		codeBlocks.push(match);
		return `[[CODE_BLOCK_${codeBlocks.length - 1}]]`;
	});

	// 行ごとに処理
	const lines = translation.split("\n").map((line) => {
		// コロンの後のスペースを削除
		line = line.replace(/:\s+/g, ":");
		// 括弧内の英語を保護
		line = line.replace(/\(([^)]+)\)/g, (_, content) => {
			return content.match(/^[a-zA-Z\s]+$/) ? `(${content})` : `（${content}）`;
		});
		return line;
	});

	// コードブロックを復元
	translation = lines
		.join("\n")
		.replace(
			/\[\[CODE_BLOCK_(\d+)]]/g,
			(_, index) => codeBlocks[Number.parseInt(index)],
		);

	console.log("Processed translation:", translation);
	return translation;
}

function openChatWithContext(context = "") {
	if (panel) {
		panel.reveal(vscode.ViewColumn.One);
	} else {
		panel = vscode.window.createWebviewPanel(
			"claudeChat",
			"Claude Chat",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
			},
		);

		panel.webview.html = getWebviewContent();

		panel.webview.onDidReceiveMessage(async (message) => {
			switch (message.command) {
				case "sendMessage":
					try {
						const response = await sendMessageToClaude(message.text);
						panel?.webview.postMessage({
							command: "receiveMessage",
							text: response,
						});
					} catch (error) {
						vscode.window.showErrorMessage(
							`Error: ${(error as Error).message}`,
						);
						panel?.webview.postMessage({
							command: "receiveMessage",
							text: `Error: ${(error as Error).message}`,
						});
					}
					break;
			}
		});

		panel.onDidDispose(() => {
			panel = undefined;
		}, null);
	}

	if (context) {
		panel.webview.postMessage({
			command: "setContext",
			text: context,
		});
	}
}

async function sendMessageToClaude(text: string): Promise<string> {
	const apiKey = getApiKey();

	if (!apiKey) {
		throw new Error(
			"Claude API key is not set. Please set it in the extension settings.",
		);
	}

	conversationHistory.push({ role: "user", content: text });

	try {
		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: "claude-3-opus-20240229",
				max_tokens: 1000,
				messages: conversationHistory,
			}),
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
	return (
		vscode.workspace.getConfiguration("commentTranslateClaude").get("apiKey") ||
		""
	);
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
                    case 'setContext':
                        appendMessage('Context: ' + message.text);
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

function isValidClaudeAPIResponse(data: unknown): data is ClaudeAPIResponse {
	return (
		typeof data === "object" &&
		data !== null &&
		"id" in data &&
		"type" in data &&
		"role" in data &&
		"content" in data &&
		Array.isArray((data as any).content) &&
		"model" in data &&
		"stop_reason" in data &&
		"stop_sequence" in data &&
		"usage" in data &&
		typeof (data as any).usage === "object" &&
		"input_tokens" in (data as any).usage &&
		"output_tokens" in (data as any).usage
	);
}

export function deactivate() {}
