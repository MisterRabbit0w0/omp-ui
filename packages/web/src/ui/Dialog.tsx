import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./Button";

/**
 * §6.15 dialog: scrim fade-in 180ms / fade-out 120ms; panel pop-in 180ms from
 * scale(.95), closes with 120ms fade + scale(.98). Radius 14, shadow-overlay.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  footer,
  width = 440,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  /** 440 default, 640 for editor-type dialogs (§6.15) */
  width?: 440 | 640;
  children?: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={
          "fixed inset-0 z-50 bg-scrim " +
          "data-[state=open]:animate-[fade-in_0.18s] " +
          "data-[state=closed]:animate-[fade-in_0.12s_reverse]"
        }
      />
      <DialogPrimitive.Content
        style={{ width }}
        className={
          "fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 " +
          "rounded-window bg-surface p-4 shadow-overlay " +
          "focus-visible:rounded-window focus-visible:shadow-overlay " +
          "data-[state=open]:animate-[pop-in_0.18s_var(--ease-out-strong)] " +
          "data-[state=closed]:opacity-0 data-[state=closed]:scale-[0.98] " +
          "data-[state=closed]:transition-[opacity,transform] data-[state=closed]:duration-120"
        }
      >
        <div className="flex items-start justify-between gap-4">
          <DialogPrimitive.Title className="text-[14px] font-semibold text-ink">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <IconButton size="sm" label="关闭">
              <X size={14} strokeWidth={2.2} className="i" />
            </IconButton>
          </DialogPrimitive.Close>
        </div>
        {description !== undefined && (
          <DialogPrimitive.Description className="mt-1.5 text-[12.5px] text-ink-2">
            {description}
          </DialogPrimitive.Description>
        )}
        {children}
        {footer !== undefined && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
