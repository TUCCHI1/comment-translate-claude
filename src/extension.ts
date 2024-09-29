import * as vscode from 'vscode';

export const activate = (context: vscode.ExtensionContext) => {
	console.log("Hover Translate is now active!");

	const hoverProvider = vscode.languages.registerHoverProvider("*", {
		provideHover: async (document, position, token) => {
			// Get the original hover information
			const originalHover = await vscode.commands.executeCommand<vscode.Hover[]>(
				"vscode.executeHoverProvider",
				document.uri,
				position
			)

			if (!originalHover || originalHover.length === 0) {
				return;
			}

			// Get the text from the first hover item
			const originalText = originalHover[0].contents
				.map(content => {
					if (typeof content === "string") {
						return content;
					} else if (content instanceof vscode.MarkdownString) {
						return content.value;
					}
					return ""
				})
				.join("\n");

			try {
				const translatedText = await translateUsingClaudeAPI(originalText);
				return new vscode.Hover(new vscode.MarkdownString(translatedText));
			} catch (error) {
				console.error("Transkation failed:", error);
				return new vscode.Hover("Translation failed");
			}
		}
	})
}

const translateUsingClaudeAPI = async (text: string) => {
	const apiKey = getApiKey();

	if (!apiKey) {
		throw new Error("Claude API key is not set. Please set it in the extenstion settings.");
	}

	try {
		const response = await fetch("https://api.anchropic.com/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"authropic-version": "2023-06-01"
			},
			body: JSON.stringify({
				model: "claude-3-5-sonnet-20240620",
				max_tokens: 1000,
				messages: [
					{role: "user", content: `Translate the following API documententation to Japanese, preserving markdown formatting: ${text}`}
				]
			})
		})

		if (!response.ok) {
			throw new Error(`API request failed with status ${response.status}`);
		}

		const data = await response.json();
		return data.content[0].text;
	} catch (error) {
		console.error("Error caling Claude API:", error);
		throw new Error("Failed to translate using Claude API");
	}
}

const getApiKey = (): string => {
	return vscode.workspace.getConfiguration("hoverTranslateClaude").get("apiKey") || ""
}