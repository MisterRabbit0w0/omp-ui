/**
 * Recognize omp tool-approval prompts (DESIGN §7.3). Under RPC the approval gate
 * calls `ui.select(full, ["Approve", "Deny"])` with a title whose first line is
 * `Allow tool: <name>` (pi-coding-agent src/tools/approval.ts).
 */
import type { ExtensionUiRequest, SelectUiRequest } from "./rpc-wire";

export interface ApprovalPrompt {
	requestId: string;
	toolName: string;
	mcp: boolean;
	reason?: string;
	details: string[];
	timeoutMs?: number;
}

export const APPROVE = "Approve";
export const DENY = "Deny";

export function isApprovalRequest(req: ExtensionUiRequest): req is SelectUiRequest {
	return (
		req.method === "select" &&
		req.options.length === 2 &&
		req.options[0] === APPROVE &&
		req.options[1] === DENY &&
		/^Allow tool: .+/.test(req.title)
	);
}

export function parseApproval(req: SelectUiRequest): ApprovalPrompt | null {
	if (!isApprovalRequest(req)) return null;
	const lines = req.title.split("\n");
	const toolName = lines[0]!.slice("Allow tool: ".length).trim();
	let i = 1;
	let mcp = false;
	let reason: string | undefined;
	if (lines[i] === "Origin: MCP server tool") {
		mcp = true;
		i++;
	}
	if (lines[i]?.startsWith("Reason: ")) {
		reason = lines[i]!.slice("Reason: ".length);
		i++;
	}
	const details = lines.slice(i).filter(l => l.length > 0);
	return { requestId: req.id, toolName, mcp, reason, details, timeoutMs: req.timeout };
}
