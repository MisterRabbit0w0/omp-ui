import {
  AppWindow,
  Bot,
  Braces,
  Code2,
  FilePlus,
  FileText,
  FolderSearch,
  Globe,
  ListChecks,
  MessageCircleQuestion,
  NotebookPen,
  PenLine,
  Plug,
  Search,
  TerminalSquare,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

/** §5 icon size presets: size px / stroke width. */
export const ICON_SIZES = {
  inline: { size: 13, strokeWidth: 2 },
  action: { size: 15, strokeWidth: 1.8 },
  primary: { size: 16, strokeWidth: 2.4 },
  chevron: { size: 13, strokeWidth: 2.2 },
} as const;

export type IconSizePreset = keyof typeof ICON_SIZES;

interface IconProps {
  icon: LucideIcon;
  preset?: IconSizePreset;
  /** explicit size overrides the preset size (stroke width stays from preset) */
  size?: number;
  className?: string;
  "aria-hidden"?: boolean;
}

/** §5: default color comes from context (ink-3 idle, ink-2 hover, ink active). */
export function Icon({ icon: Lucide, preset = "inline", size, className, ...rest }: IconProps) {
  const p = ICON_SIZES[preset];
  return (
    <Lucide
      size={size ?? p.size}
      strokeWidth={p.strokeWidth}
      className={className ?? "shrink-0"}
      aria-hidden={rest["aria-hidden"] ?? true}
    />
  );
}

/** §5 tool → icon mapping. Unknown tools fall back to Wrench. */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  read: FileText,
  write: FilePlus,
  edit: PenLine,
  bash: TerminalSquare,
  python: Code2,
  grep: Search,
  find: Search,
  glob: FolderSearch,
  lsp: Braces,
  web_search: Globe,
  browser: AppWindow,
  task: Bot,
  todo: ListChecks,
  ask: MessageCircleQuestion,
  notebook: NotebookPen,
  mcp: Plug,
};

export function toolIcon(tool: string): LucideIcon {
  return TOOL_ICONS[tool] ?? Wrench;
}

/** §5 thinking icon: filled four-point star (Beautiful UI sparkle path). */
export const SparkleIcon: ComponentType<{ size?: number; className?: string }> = ({
  size = 16,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    className={className ?? "shrink-0"}
    aria-hidden="true"
  >
    <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
  </svg>
);
