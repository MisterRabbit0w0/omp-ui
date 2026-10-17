import * as SwitchPrimitive from "@radix-ui/react-switch";

/**
 * §6.14 switch: 28×16, radius 999, on bg-ink / off bg-line-strong,
 * 12px surface thumb, 200ms.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={
        "inline-flex h-4 w-7 shrink-0 items-center rounded-pill px-0.5 " +
        "bg-line-strong transition-colors duration-200 data-[state=checked]:bg-ink " +
        "disabled:cursor-default disabled:opacity-35"
      }
    >
      <SwitchPrimitive.Thumb
        className={
          "size-3 rounded-full bg-surface shadow-hairline transition-transform duration-200 " +
          "data-[state=checked]:translate-x-3"
        }
      />
    </SwitchPrimitive.Root>
  );
}
