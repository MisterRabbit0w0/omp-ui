/**
 * Streaming text tail splitter (FRONTEND §4.3).
 * Only the last ~24 characters are wrapped in `.stream-tail` (blur + fade mask)
 * followed by `.stream-caret`; earlier text renders without per-word spans.
 */

export interface StreamTailSplit {
	head: string;
	tail: string;
}

/**
 * Split `text` into `{ head, tail }` where `tail` holds at most `tailChars`
 * code points from the end of `text` (never splitting surrogate pairs).
 * If the trailing slice contains a newline before the last line, we keep `tail`
 * within the last line so block-level markdown structures above are not broken.
 */
export function splitStreamTail(text: string, tailChars = 24): StreamTailSplit {
	if (!text || tailChars <= 0) {
		return { head: text ?? "", tail: "" };
	}
	const codePoints = Array.from(text);
	if (codePoints.length <= tailChars) {
		const lastNl = text.lastIndexOf("\n");
		if (lastNl >= 0 && lastNl < text.length - 1) {
			return {
				head: text.slice(0, lastNl + 1),
				tail: text.slice(lastNl + 1),
			};
		}
		return { head: "", tail: text };
	}
	const splitIdx = codePoints.length - tailChars;
	let head = codePoints.slice(0, splitIdx).join("");
	let tail = codePoints.slice(splitIdx).join("");
	const nlInTail = tail.lastIndexOf("\n");
	if (nlInTail >= 0 && nlInTail < tail.length - 1) {
		head += tail.slice(0, nlInTail + 1);
		tail = tail.slice(nlInTail + 1);
	}
	return { head, tail };
}
