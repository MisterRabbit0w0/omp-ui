import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import type { ReactNode } from "react";

/**
 * §6.7 checkbox: 16px, radius 5, unchecked inset 1.5px line-strong ring,
 * checked bg-ink with canvas check, 200ms. Optional 12.5 ink-2 label.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  id?: string;
}) {
  const box = (
    <CheckboxPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={
        "grid size-4 shrink-0 place-items-center rounded-[5px] text-transparent " +
        "shadow-[inset_0_0_0_1.5px_var(--line-strong)] transition-[background-color,color,box-shadow] duration-200 " +
        "data-[state=checked]:bg-ink data-[state=checked]:text-canvas data-[state=checked]:shadow-none " +
        "disabled:cursor-default disabled:opacity-35"
      }
    >
      <CheckboxPrimitive.Indicator>
        <svg width={10} height={10} viewBox="0 0 24 24" className="i" strokeWidth={3.5}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (label === undefined) return box;
  return (
    <label
      htmlFor={id}
      className={
        "inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2 " +
        (disabled ? "cursor-default opacity-35" : "")
      }
    >
      {box}
      {label}
    </label>
  );
}
