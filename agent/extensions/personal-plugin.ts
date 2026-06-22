/**
 * Personal plugin: map bare editor input to built-in slash commands.
 *
 * Current aliases:
 * - `exit`  -> `/quit`
 * - `clear` -> `/new`
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

class CommandAliasEditor extends CustomEditor {
	handleInput(data: string): void {
		if (matchesKey(data, "enter")) {
			const text = this.getText().trim();

			if (text === "exit") {
				this.setText("/quit");
			} else if (text === "clear") {
				this.setText("/new");
			}
		}

		super.handleInput(data);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new CommandAliasEditor(tui, theme, keybindings));
	});
}
