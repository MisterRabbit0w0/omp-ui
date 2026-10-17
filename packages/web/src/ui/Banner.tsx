import type { ReactNode } from "react";

type BannerVariant = "retry" | "error" | "neutral";

const VARIANT: Record<BannerVariant, { root: string; title: string; icon: string }> = {
  // §6.17 retry: orange-tint, icon/title orange-ink
  retry: { root: "bg-orange-tint", title: "text-orange-ink", icon: "text-orange" },
  // §6.17 error: red-tint, title red-ink, shakes once on entry
  error: { root: "bg-red-tint anim-shake", title: "text-red-ink", icon: "text-red" },
  // §6.17 process exit: bg-field + hairline
  neutral: { root: "bg-field shadow-hairline", title: "text-ink", icon: "text-ink-2" },
};

/**
 * §6.17 in-conversation banner: content-column width, radius 10,
 * padding 10/12, 13px. Title + body + optional action on the right.
 */
export function Banner({
  variant,
  icon,
  title,
  action,
  children,
}: {
  variant: BannerVariant;
  icon?: ReactNode;
  title: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const v = VARIANT[variant];
  return (
    <div role={variant === "error" ? "alert" : "status"} className={"flex items-center gap-2.5 rounded-card px-3 py-2.5 text-[13px] " + v.root}>
      {icon !== undefined && <span className={"inline-flex shrink-0 " + v.icon}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <b className={"font-medium " + v.title}>{title}</b>
        {children !== undefined && <span className="text-ink"> · {children}</span>}
      </span>
      {action}
    </div>
  );
}
