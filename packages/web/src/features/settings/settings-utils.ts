export interface AppearancePrefs {
	fontSize: 12 | 13 | 14;
	compact: boolean;
	sound: boolean;
}

const PREFS_STORAGE_KEY = "omp-ui:appearance-prefs";

export const DEFAULT_APPEARANCE_PREFS: AppearancePrefs = {
	fontSize: 13,
	compact: false,
	sound: false,
};

export function loadAppearancePrefs(): AppearancePrefs {
	try {
		const raw = localStorage.getItem(PREFS_STORAGE_KEY);
		if (!raw) return DEFAULT_APPEARANCE_PREFS;
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return DEFAULT_APPEARANCE_PREFS;
		const fontSize =
			"fontSize" in parsed && (parsed.fontSize === 12 || parsed.fontSize === 13 || parsed.fontSize === 14)
				? parsed.fontSize
				: 13;
		const compact = "compact" in parsed && typeof parsed.compact === "boolean" ? parsed.compact : false;
		const sound = "sound" in parsed && typeof parsed.sound === "boolean" ? parsed.sound : false;
		return { fontSize, compact, sound };
	} catch {
		return DEFAULT_APPEARANCE_PREFS;
	}
}

export function saveAppearancePrefs(prefs: AppearancePrefs): void {
	try {
		localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
	} catch {
		/* ignore */
	}
	applyAppearancePrefs(prefs);
}

export function applyAppearancePrefs(prefs: AppearancePrefs): void {
	if (typeof document === "undefined") return;
	// Keep the 16px rem root so Tailwind spacing/heights stay fixed (FRONTEND §2.5); the
	// setting scales every pixel text size through `--app-font-scale` in base.css instead.
	document.documentElement.style.setProperty("--app-font-scale", String(prefs.fontSize / DEFAULT_APPEARANCE_PREFS.fontSize));
	document.documentElement.toggleAttribute("data-compact", prefs.compact);
}

export interface ShortcutSpec {
	keys: string[];
	label: string;
}

export const SHORTCUTS_LIST: readonly ShortcutSpec[] = [
	{ keys: ["Ctrl", "N"], label: "新建对话" },
	{ keys: ["Ctrl", "K"], label: "打开命令面板" },
	{ keys: ["Ctrl", "M"], label: "切换模型" },
	{ keys: ["Ctrl", "T"], label: "循环切换思考级别" },
	{ keys: ["Ctrl", "B"], label: "折叠 / 展开左侧边栏" },
	{ keys: ["Ctrl", "."], label: "折叠 / 展开右侧面板" },
	{ keys: ["Ctrl", "L"], label: "聚焦消息输入框" },
	{ keys: ["Esc", "Esc"], label: "停止当前运行" },
	{ keys: ["Alt", "↑ / ↓"], label: "切换上 / 下一个会话" },
	{ keys: ["Ctrl", "Shift", "C"], label: "复制最后一条助手回答" },
];
