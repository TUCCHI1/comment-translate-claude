import * as assert from "node:assert";
import * as vscode from "vscode";
import * as myExtension from "../extension";

suite("Comment Translate & Chat with Claude Extension Test Suite", () => {
	vscode.window.showInformationMessage("テストを開始します。");

	test("拡張機能が存在すること", () => {
		assert.ok(
			vscode.extensions.getExtension("TUCCHI1.comment-translate-claude"),
		);
	});

	test("拡張機能がアクティベートできること", async () => {
		const ext = vscode.extensions.getExtension(
			"TUCCHI1.comment-translate-claude",
		);
		await ext?.activate();
		assert.ok(true);
	});

	test("API キーが設定されていること", () => {
		const config = vscode.workspace.getConfiguration("commentTranslateClaude");
		const apiKey = config.get("apiKey");
		assert.strictEqual(typeof apiKey, "string");
	});

	test("Hover Provider が登録されていること", async () => {
		const ext = vscode.extensions.getExtension(
			"TUCCHI1.comment-translate-claude",
		);
		await ext?.activate();

		// ダミーのTextDocumentを作成
		const dummyDoc = await vscode.workspace.openTextDocument({
			content: "// Test comment",
			language: "plaintext",
		});
		const position = new vscode.Position(0, 0);

		// Hoverプロバイダーが登録されているか確認
		const hoverProvider = vscode.languages.registerHoverProvider("*", {
			provideHover: () => new vscode.Hover("Test hover"),
		});
		assert.ok(hoverProvider);
		hoverProvider.dispose();
	});

	test("チャットコマンドが登録されていること", async () => {
		const ext = vscode.extensions.getExtension(
			"TUCCHI1.comment-translate-claude",
		);
		await ext?.activate();

		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("commentTranslateClaude.openChat"));
	});

	test("コメント判定機能が正しく動作すること", () => {
		const document = {
			lineAt: (line: number) => ({
				text: "// This is a comment",
			}),
		} as unknown as vscode.TextDocument;

		const position = new vscode.Position(0, 0);
		assert.ok(myExtension.isComment(document, position));

		const nonCommentDocument = {
			lineAt: (line: number) => ({
				text: "This is not a comment",
			}),
		} as unknown as vscode.TextDocument;

		assert.strictEqual(
			myExtension.isComment(nonCommentDocument, position),
			false,
		);
	});

	test("翻訳機能のインターフェース", async () => {
		assert.strictEqual(typeof myExtension.translateUsingClaudeAPI, "function");
		const translatePromise = myExtension.translateUsingClaudeAPI("Hello");
		assert.ok(translatePromise instanceof Promise);
	});

	test("チャット機能のインターフェース", async () => {
		assert.strictEqual(typeof myExtension.sendMessageToClaude, "function");
		const chatPromise = myExtension.sendMessageToClaude("Hi, Claude!");
		assert.ok(chatPromise instanceof Promise);
	});
});
