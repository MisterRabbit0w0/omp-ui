import { stripPrivateUse } from "../sidebar/sidebar-utils";
import type { ModelInfo, SessionListItem } from "@omp-ui/protocol";
import { cwdGroupLabel, fuzzyScore } from "@/features/sidebar/sidebar-utils";

export type PaletteCategory = "会话" | "操作" | "模型";

export interface PaletteItem {
	id: string;
	category: PaletteCategory;
	label: string;
	subtitle?: string;
	kbd?: string;
	keywords?: string;
	sessionItem?: SessionListItem;
	modelInfo?: ModelInfo;
	actionId?: string;
}

export interface PaletteGroup {
	category: PaletteCategory;
	items: PaletteItem[];
}

export const STATIC_PALETTE_ACTIONS: readonly PaletteItem[] = [
	{ id: "act:new-session", category: "操作", label: "新对话", kbd: "Ctrl N", actionId: "new-session", keywords: "new session chat 新建对话" },
	{ id: "act:compact", category: "操作", label: "压缩上下文", actionId: "compact", keywords: "compact context" },
	{ id: "act:handoff", category: "操作", label: "交接到新会话", actionId: "handoff", keywords: "handoff transfer" },
	{ id: "act:fork", category: "操作", label: "分叉为新会话", actionId: "fork", keywords: "fork branch" },
	{ id: "act:tree", category: "操作", label: "查看会话树", actionId: "tree", keywords: "tree history branch" },
	{ id: "act:export", category: "操作", label: "导出 HTML", actionId: "export", keywords: "export html download" },
	{ id: "act:copy-last", category: "操作", label: "复制最后回答", kbd: "Ctrl+Shift+C", actionId: "copy-last", keywords: "copy last assistant" },
	{ id: "act:btw", category: "操作", label: "打开旁问 (btw)", actionId: "btw", keywords: "btw side question" },
	{ id: "act:toggle-sidebar", category: "操作", label: "折叠/展开侧边栏", kbd: "Ctrl B", actionId: "toggle-sidebar", keywords: "sidebar left panel" },
	{ id: "act:toggle-panel", category: "操作", label: "折叠/展开右侧面板", kbd: "Ctrl .", actionId: "toggle-panel", keywords: "panel right drawer" },
	{ id: "act:cycle-theme", category: "操作", label: "切换明暗主题", actionId: "cycle-theme", keywords: "theme dark light mode" },
	{ id: "act:settings", category: "操作", label: "打开设置", actionId: "settings", keywords: "settings preferences config" },
	{ id: "act:diagnostics", category: "操作", label: "打开会话诊断", actionId: "diagnostics", keywords: "diagnostics stderr logs" },
];

export function buildPaletteItems(
	sessions: readonly SessionListItem[],
	models: readonly ModelInfo[],
	actions: readonly PaletteItem[] = STATIC_PALETTE_ACTIONS,
): PaletteItem[] {
	const items: PaletteItem[] = [];

	const sortedSessions = [...sessions]
		.filter(s => !s.archived)
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	for (const s of sortedSessions) {
		items.push({
			id: `sess:${s.id}`,
			category: "会话",
			label: stripPrivateUse(s.title) || "新对话",
			subtitle: cwdGroupLabel(s.cwd),
			keywords: `${stripPrivateUse(s.title)} ${s.cwd}`,
			sessionItem: s,
		});
	}

	items.push(...actions);

	for (const m of models) {
		items.push({
			id: `model:${m.provider}/${m.id}`,
			category: "模型",
			label: m.name || m.id,
			subtitle: m.provider,
			keywords: `${m.provider} ${m.id} ${m.name}`,
			modelInfo: m,
		});
	}

	return items;
}

export function filterPaletteGroups(items: readonly PaletteItem[], query: string): PaletteGroup[] {
	const q = query.trim();
	const scored: { item: PaletteItem; score: number }[] = [];

	for (const item of items) {
		if (!q) {
			scored.push({ item, score: 1 });
			continue;
		}
		const target = `${item.label} ${item.subtitle ?? ""} ${item.keywords ?? ""}`;
		const s = fuzzyScore(q, target);
		if (s > 0) {
			scored.push({ item, score: s });
		}
	}

	if (q) {
		scored.sort((a, b) => b.score - a.score);
	}

	const categories: PaletteCategory[] = ["会话", "操作", "模型"];
	const groups: PaletteGroup[] = [];
	for (const cat of categories) {
		const catItems = scored
			.filter(s => s.item.category === cat)
			.map(s => s.item)
			.slice(0, q ? 12 : 6);
		if (catItems.length > 0) {
			groups.push({ category: cat, items: catItems });
		}
	}
	return groups;
}
