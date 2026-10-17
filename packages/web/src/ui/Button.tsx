import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Spinner } from "./Spinner";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  // §2.2 primary: ink fill, surface text, top highlight
  primary:
    "bg-ink text-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
  // §2.2 level 1b
  secondary: "bg-surface shadow-btn hover:bg-hover",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink",
  danger: "bg-red text-white",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-6 px-1.5 text-[11.5px] gap-1.5",
  md: "h-7 px-2.5 text-[12.5px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** leading icon slot; replaced by a spinner while loading (width kept) */
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading = false, disabled, className, children, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={
        "inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-control font-medium " +
        "transition-[background-color_0.1s,color_0.1s,transform_0.2s] " +
        "active:scale-96 " +
        (isDisabled ? "cursor-default opacity-35 active:scale-100 " : "") +
        VARIANT_CLASS[variant] + " " + SIZE_CLASS[size] + " " + (className ?? "")
      }
      {...rest}
    >
      {icon !== undefined || loading ? (
        <span className="relative inline-flex shrink-0 items-center justify-center">
          {/* keep the icon slot so width does not change while loading (§7) */}
          <span className={loading ? "invisible inline-flex" : "inline-flex"}>{icon}</span>
          {loading && (
            <span className="absolute inset-0 grid place-items-center">
              <Spinner />
            </span>
          )}
        </span>
      ) : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "md" | "sm";
  label: string;
}

/** §2.5 / prototype .ibtn: 28×28 (sm 24×24 radius 6), ink-3 → ink-2 on hover. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "md", label, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={
        "inline-flex shrink-0 items-center justify-center text-ink-3 " +
        "transition-[background-color_0.1s,color_0.1s,transform_0.2s] hover:bg-hover-2 hover:text-ink-2 " +
        "active:scale-96 " +
        (size === "sm" ? "size-6 rounded-[6px] " : "size-7 rounded-control ") +
        (disabled ? "pointer-events-none opacity-35 " : "") +
        (className ?? "")
      }
      {...rest}
    >
      {children}
    </button>
  );
});
