const RELAY_STATE = Symbol.for("pi-herdr-clipboard.relay-state");

export const MAX_OSC52_ENCODED_LENGTH = 100_000;

export interface TextClipboard {
	setText(text: string): Promise<void> | void;
}

type RelayState = {
	original: TextClipboard["setText"];
	wrapped: TextClipboard["setText"];
};

type RelayClipboard = TextClipboard & {
	[RELAY_STATE]?: RelayState;
};

export function shouldRelayClipboard(env: NodeJS.ProcessEnv): boolean {
	return Boolean(env.HERDR_ENV);
}

export function osc52Sequence(text: string): string | undefined {
	const encoded = Buffer.from(text).toString("base64");
	if (encoded.length > MAX_OSC52_ENCODED_LENGTH) return undefined;
	return `\u001b]52;c;${encoded}\u0007`;
}

/**
 * Mirror successful host clipboard writes into the Herdr pane as OSC 52.
 * Herdr routes the request to its foreground client, which chooses its local
 * clipboard or its outer terminal according to that client's own transport.
 */
export function installHerdrClipboardRelay(
	clipboard: TextClipboard,
	write: (sequence: string) => unknown,
	env: NodeJS.ProcessEnv = process.env,
): () => void {
	if (!shouldRelayClipboard(env)) return () => {};

	const target = clipboard as RelayClipboard;
	if (target[RELAY_STATE]) return () => {};

	const original = target.setText;
	const wrapped: TextClipboard["setText"] = async function (text: string) {
		let nativeFailed = false;
		let nativeError: unknown;
		try {
			await original.call(target, text);
		} catch (error) {
			nativeFailed = true;
			nativeError = error;
		}

		const sequence = osc52Sequence(text);
		if (sequence) {
			try {
				write(sequence);
			} catch {
				// A relay failure must not turn a successful native copy into an error.
			}
		}

		if (nativeFailed) throw nativeError;
	};

	target[RELAY_STATE] = { original, wrapped };
	target.setText = wrapped;

	let active = true;
	return () => {
		if (!active) return;
		active = false;
		const state = target[RELAY_STATE];
		if (state?.wrapped !== wrapped || target.setText !== wrapped) return;
		target.setText = original;
		delete target[RELAY_STATE];
	};
}
