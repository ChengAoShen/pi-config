/**
 * Command aliases and small editor conveniences.
 *
 * Current aliases:
 * - `exit`  -> `/quit`
 * - `clear` -> `/new`
 *
 * Slash command completion:
 * - Pressing Enter on an incomplete slash command first accepts the visible
 *   autocomplete candidate, then submits it. This avoids the common `/job` + Tab
 *   + Enter flow for unique command prefixes such as `/job` -> `/jobs`.
 *
 * The editor is installed as a wrapper around any previously configured editor,
 * so it composes with ui-optimize's image-token editor instead of replacing it.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, type EditorComponent, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { AppKeybinding, KeybindingsManager } from "@earendil-works/pi-coding-agent";

type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent;

function applyAlias(text: string): string {
	const trimmed = text.trim();
	if (trimmed === "exit") return "/quit";
	if (trimmed === "clear") return "/new";
	return text;
}

function isIncompleteSlashCommand(text: string): boolean {
	return /^\/[^\s]*$/.test(text.trim());
}

class CommandAliasEditor extends CustomEditor {
	handleInput(data: string): void {
		if (matchesKey(data, "enter")) {
			if (isIncompleteSlashCommand(this.getText()) && this.isShowingAutocomplete?.()) {
				const before = this.getText();
				super.handleInput("\t");
				if (this.getText() !== before) {
					this.setText(applyAlias(this.getText()));
					super.handleInput(data);
					return;
				}
			}
			this.setText(applyAlias(this.getText()));
		}
		super.handleInput(data);
	}
}

class CommandAliasEditorWrapper implements EditorComponent {
	actionHandlers = new Map<AppKeybinding, () => void>();

	constructor(private readonly inner: EditorComponent) {}

	get onEscape(): (() => void) | undefined { return (this.inner as EditorComponent & { onEscape?: () => void }).onEscape; }
	set onEscape(handler: (() => void) | undefined) { (this.inner as EditorComponent & { onEscape?: () => void }).onEscape = handler; }
	get onCtrlD(): (() => void) | undefined { return (this.inner as EditorComponent & { onCtrlD?: () => void }).onCtrlD; }
	set onCtrlD(handler: (() => void) | undefined) { (this.inner as EditorComponent & { onCtrlD?: () => void }).onCtrlD = handler; }
	get onPasteImage(): (() => void) | undefined { return (this.inner as EditorComponent & { onPasteImage?: () => void }).onPasteImage; }
	set onPasteImage(handler: (() => void) | undefined) { (this.inner as EditorComponent & { onPasteImage?: () => void }).onPasteImage = handler; }
	get onExtensionShortcut(): ((data: string) => boolean) | undefined { return (this.inner as EditorComponent & { onExtensionShortcut?: (data: string) => boolean }).onExtensionShortcut; }
	set onExtensionShortcut(handler: ((data: string) => boolean) | undefined) { (this.inner as EditorComponent & { onExtensionShortcut?: (data: string) => boolean }).onExtensionShortcut = handler; }

	get focused(): boolean { return Boolean((this.inner as EditorComponent & { focused?: boolean }).focused); }
	set focused(value: boolean) { (this.inner as EditorComponent & { focused?: boolean }).focused = value; }
	get borderColor(): ((str: string) => string) | undefined { return this.inner.borderColor; }
	set borderColor(value: ((str: string) => string) | undefined) { this.inner.borderColor = value; }
	get onSubmit(): ((text: string) => void) | undefined { return this.inner.onSubmit; }
	set onSubmit(handler: ((text: string) => void) | undefined) { this.inner.onSubmit = handler; }
	get onChange(): ((text: string) => void) | undefined { return this.inner.onChange; }
	set onChange(handler: ((text: string) => void) | undefined) { this.inner.onChange = handler; }

	getText(): string { return this.inner.getText(); }
	setText(text: string): void { this.inner.setText(text); }
	getExpandedText(): string { return this.inner.getExpandedText?.() ?? this.inner.getText(); }
	addToHistory(text: string): void { this.inner.addToHistory?.(text); }
	setAutocompleteProvider(provider: Parameters<NonNullable<EditorComponent["setAutocompleteProvider"]>>[0]): void { this.inner.setAutocompleteProvider?.(provider); }
	setPaddingX(padding: number): void { this.inner.setPaddingX?.(padding); }
	setAutocompleteMaxVisible(maxVisible: number): void { this.inner.setAutocompleteMaxVisible?.(maxVisible); }
	onAction(action: AppKeybinding, handler: () => void): void {
		this.actionHandlers.set(action, handler);
		this.inner.onAction?.(action, handler);
	}
	invalidate(): void { this.inner.invalidate?.(); }
	insertTextAtCursor(text: string): void {
		if (this.inner.insertTextAtCursor) this.inner.insertTextAtCursor(text);
		else {
			this.inner.setText(this.inner.getText() + text);
			this.inner.onChange?.(this.inner.getText());
		}
	}
	render(width: number): string[] { return this.inner.render(width); }
	isShowingAutocomplete(): boolean { return (this.inner as EditorComponent & { isShowingAutocomplete?: () => boolean }).isShowingAutocomplete?.() ?? false; }

	handleInput(data: string): void {
		if (matchesKey(data, "enter")) {
			if (isIncompleteSlashCommand(this.inner.getText()) && this.isShowingAutocomplete()) {
				const before = this.inner.getText();
				this.inner.handleInput?.("\t");
				if (this.inner.getText() !== before) {
					this.inner.setText(applyAlias(this.inner.getText()));
					this.inner.handleInput?.(data);
					return;
				}
			}
			this.inner.setText(applyAlias(this.inner.getText()));
		}
		this.inner.handleInput?.(data);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		const previous = ctx.ui.getEditorComponent() as EditorFactory | undefined;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			if (!previous) return new CommandAliasEditor(tui, theme, keybindings);
			return new CommandAliasEditorWrapper(previous(tui, theme, keybindings));
		});
	});
}
