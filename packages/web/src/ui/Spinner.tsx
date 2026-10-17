/** 12px ring spinner (§6.5): 1.5px line-strong track, ink-2 top arc, 700ms. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="progressbar"
      aria-label="加载中"
      className={
        "inline-block size-3 animate-[spin_0.7s_linear_infinite] rounded-full border-[1.5px] border-line-strong border-t-ink-2 " +
        (className ?? "")
      }
    />
  );
}

/**
 * 24px SpinnerRing (§6.13): 2px track `line`, 28% arc `ink-3`, 1.1s rotation,
 * optional index number (10.5/600) in the middle.
 */
export function SpinnerRing({
  active = false,
  index,
  className,
}: {
  active?: boolean;
  index?: number;
  className?: string;
}) {
  return (
    <span
      role={active ? "progressbar" : undefined}
      className={
        "relative grid size-6 shrink-0 place-items-center text-[10.5px] font-semibold text-ink-3 " +
        (className ?? "")
      }
    >
      <svg
        viewBox="0 0 22 22"
        width={24}
        height={24}
        className={"absolute inset-0 " + (active ? "animate-[spin_1.1s_linear_infinite]" : "")}
      >
        <circle cx={11} cy={11} r={10} fill="none" stroke="var(--line)" strokeWidth={2} />
        <circle
          cx={11}
          cy={11}
          r={10}
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="17.6 45.2"
        />
      </svg>
      {index !== undefined && <span className="relative">{index}</span>}
    </span>
  );
}
