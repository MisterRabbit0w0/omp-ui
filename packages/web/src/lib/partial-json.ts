/**
 * Tolerant parser for possibly-truncated JSON text (streaming tool-call
 * arguments arrive as deltas; DESIGN §6.2 wants a live argument preview).
 * Returns the longest complete prefix of `text` as a value, or `undefined`
 * when nothing parseable is there yet.
 */
export function parsePartialJson(text: string): unknown {
	const s = text.trim();
	if (s.length === 0) return undefined;
	try {
		return JSON.parse(s);
	} catch {
		/* truncated: fall through */
	}

	const BACKSLASH = 0x5c;
	const QUOTE = 0x22;
	const stack: string[] = []; // closers expected, innermost last
	let inString = false;
	let escaped = false;
	let inScalar = false;
	// Inside an object, a string can be a key (no value follows yet) or a value.
	// Only completed values are safe cut points.
	let expectingKey = false;
	// Longest prefix ending at a complete value (or an empty container start),
	// with the container stack as it was at that point.
	let cut = -1;
	let cutStack: string[] = [];

	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (inString) {
			if (escaped) escaped = false;
			else if (c === BACKSLASH) escaped = true;
			else if (c === QUOTE) {
				inString = false;
				if (stack[stack.length - 1] === "}" && expectingKey) {
					expectingKey = false; // object key, not a value: no cut
				} else {
					cut = i + 1;
					cutStack = [...stack];
				}
			}
			continue;
		}
		if (c === QUOTE) {
			inString = true;
			inScalar = false;
			continue;
		}
		if (c === 0x7b || c === 0x5b) {
			// { [
			if (inScalar) {
				cut = i;
				cutStack = [...stack];
				inScalar = false;
			}
			stack.push(c === 0x7b ? "}" : "]");
			expectingKey = c === 0x7b;
			cut = i + 1;
			cutStack = [...stack];
			continue;
		}
		if (c === 0x7d || c === 0x5d) {
			// } ]
			if (inScalar) {
				cut = i;
				cutStack = [...stack];
				inScalar = false;
			}
			if (stack[stack.length - 1] !== String.fromCharCode(c)) return undefined; // malformed
			stack.pop();
			expectingKey = false; // a closed container is a complete value in its parent
			cut = i + 1;
			cutStack = [...stack];
			continue;
		}
		if (c === 0x2c || c === 0x3a) {
			// , :
			if (inScalar) {
				cut = i;
				cutStack = [...stack];
				inScalar = false;
			}
			expectingKey = c === 0x2c && stack[stack.length - 1] === "}";
			continue;
		}
		if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
			if (inScalar) {
				cut = i;
				cutStack = [...stack];
				inScalar = false;
			}
			continue;
		}
		inScalar = true;
	}
	// A trailing scalar is not a safe cut point: candidate A closes it in place
	// (`{"a": 12`), and if that fails (`{"a": tru`) candidate B drops back to
	// the last complete value.

	// Candidate A: close an unterminated string / trailing scalar in place,
	// then close every open container.
	if (inString || inScalar) {
		const a = (inString ? `${s}"` : s) + [...stack].reverse().join("");
		try {
			return JSON.parse(a);
		} catch {
			/* fall through */
		}
	}
	if (cut < 0) return undefined;
	// Candidate B: drop the dangling tail back to the last complete value.
	const b = s.slice(0, cut) + [...cutStack].reverse().join("");
	try {
		return JSON.parse(b);
	} catch {
		return undefined;
	}
}
