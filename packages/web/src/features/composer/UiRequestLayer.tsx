import type {
	ConfirmUiRequest,
	EditorUiRequest,
	ExtensionUiResponse,
	InputUiRequest,
	SelectUiRequest,
} from "@omp-ui/protocol";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { useSessionView } from "@/store/hooks";
import type { SessionView } from "@/store/session-reducer";
import { Button, IconButton } from "@/ui/Button";
import { Kbd } from "@/ui/Chip";
import { useSlidingHighlight } from "@/ui/sliding-highlight";
import {
	buildCancelResponse,
	buildTimeoutResponse,
	isOAuthCodeInputRequest,
	selectActiveModalUiRequest,
	validateOAuthCodeInput,
	type ModalUiRequest,
} from "./logic";

function TimeoutBar({ timeoutMs, onTimeout }: { timeoutMs?: number; onTimeout: () => void }) {
	const onTimeoutRef = useRef(onTimeout);
	onTimeoutRef.current = onTimeout;

	const [shrinking, setShrinking] = useState(false);

	useEffect(() => {
		if (!timeoutMs || timeoutMs <= 0) return;
		setShrinking(false);
		const raf = requestAnimationFrame(() => {
			setShrinking(true);
		});
		const timer = setTimeout(() => {
			onTimeoutRef.current();
		}, timeoutMs);
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(timer);
		};
	}, [timeoutMs]);

	if (!timeoutMs || timeoutMs <= 0) return null;

	return (
		<div
			aria-hidden="true"
			style={{
				transitionDuration: `${timeoutMs}ms`,
				transform: shrinking ? "scaleX(0)" : "scaleX(1)",
			}}
			className="absolute top-0 right-0 left-0 h-0.5 origin-left bg-accent transition-transform ease-linear"
		/>
	);
}

function SelectModalBody({
	req,
	onRespond,
}: {
	req: SelectUiRequest;
	onRespond: (res: ExtensionUiResponse) => void;
}) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const hl = useSlidingHighlight<HTMLDivElement>({ variant: "menu", restOnActive: true });

	useEffect(() => {
		setSelectedIndex(0);
	}, [req.id]);

	useEffect(() => {
		const id = requestAnimationFrame(() => hl.onPointerLeave());
		return () => cancelAnimationFrame(id);
	}, [selectedIndex, req.options.length, hl.onPointerLeave]);

	const commitOption = (index: number) => {
		const value = req.options[index];
		if (value === undefined) return;
		onRespond({ type: "extension_ui_response", id: req.id, value });
	};

	return (
		<div
			onKeyDown={e => {
				if (req.options.length === 0) return;
				if (e.key === "ArrowDown") {
					e.preventDefault();
					setSelectedIndex(i => (i + 1) % req.options.length);
				} else if (e.key === "ArrowUp") {
					e.preventDefault();
					setSelectedIndex(i => (i - 1 + req.options.length) % req.options.length);
				} else if (e.key === "Enter") {
					e.preventDefault();
					commitOption(selectedIndex);
				}
			}}
		>
			<div
				ref={hl.containerRef}
				onPointerOver={hl.onPointerOver}
				onFocus={hl.onFocus}
				onPointerLeave={hl.onPointerLeave}
				role="listbox"
				aria-label={req.title}
				className="relative mt-3 max-h-[260px] overflow-y-auto rounded-card bg-inset p-1 shadow-hairline"
			>
				{hl.highlightBlock}
				{req.options.map((opt, idx) => {
					const detail = req.optionDetails?.[idx]?.description;
					const active = idx === selectedIndex;
					return (
						<button
							key={`${idx}-${opt}`}
							type="button"
							role="option"
							aria-selected={active}
							data-hl-item=""
							{...(active ? { "data-hl-active": "" } : {})}
							onMouseEnter={() => setSelectedIndex(idx)}
							onClick={() => commitOption(idx)}
							className="relative z-10 flex min-h-8 w-full flex-col justify-center rounded-[6px] px-2.5 py-1.5 text-left"
						>
							<span className="text-[13px] font-medium text-ink">{opt}</span>
							{detail && <span className="mt-0.5 text-[12px] text-ink-2">{detail}</span>}
						</button>
					);
				})}
			</div>
			<div className="mt-4 flex justify-end gap-2">
				<Button variant="secondary" onClick={() => onRespond(buildCancelResponse(req.id))}>
					取消 <Kbd>Esc</Kbd>
				</Button>
				<Button
					variant="primary"
					disabled={req.options.length === 0}
					onClick={() => commitOption(selectedIndex)}
				>
					确认 <Kbd tone="onInk">Enter</Kbd>
				</Button>
			</div>
		</div>
	);
}

function ConfirmModalBody({
	req,
	onRespond,
}: {
	req: ConfirmUiRequest;
	onRespond: (res: ExtensionUiResponse) => void;
}) {
	return (
		<div>
			<div className="mt-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{req.message}</div>
			<div className="mt-4 flex justify-end gap-2">
				<Button
					variant="secondary"
					onClick={() => onRespond({ type: "extension_ui_response", id: req.id, confirmed: false })}
				>
					取消 <Kbd>Esc</Kbd>
				</Button>
				<Button
					variant="primary"
					autoFocus
					onClick={() => onRespond({ type: "extension_ui_response", id: req.id, confirmed: true })}
				>
					确认 <Kbd tone="onInk">Enter</Kbd>
				</Button>
			</div>
		</div>
	);
}

function InputModalBody({
	req,
	onRespond,
}: {
	req: InputUiRequest;
	onRespond: (res: ExtensionUiResponse) => void;
}) {
	const [value, setValue] = useState("");
	const [errorText, setErrorText] = useState<string | null>(null);
	const isOAuthCode = isOAuthCodeInputRequest(req);

	useEffect(() => {
		setValue("");
		setErrorText(null);
	}, [req.id]);

	const submit = () => {
		if (isOAuthCode) {
			const check = validateOAuthCodeInput(value);
			if (!check.valid) {
				setErrorText(check.error ?? "请输入有效的授权码");
				return;
			}
			onRespond({ type: "extension_ui_response", id: req.id, value: value.trim() });
			return;
		}
		onRespond({ type: "extension_ui_response", id: req.id, value });
	};

	return (
		<div>
			<div className="mt-3">
				<input
					type="text"
					value={value}
					autoFocus
					onChange={e => {
						setValue(e.target.value);
						if (errorText) setErrorText(null);
					}}
					onKeyDown={e => {
						if (e.nativeEvent.isComposing || e.keyCode === 229) return;
						if (e.key === "Enter") {
							e.preventDefault();
							submit();
						}
					}}
					placeholder={req.placeholder ?? "请输入…"}
					aria-label={req.title}
					className="h-8 w-full rounded-control bg-inset px-2.5 text-[13px] text-ink shadow-hairline outline-none focus:ring-1 focus:ring-line-strong placeholder:text-ink-3"
				/>
				{errorText && <div className="mt-1.5 text-[12px] text-red">{errorText}</div>}
			</div>
			<div className="mt-4 flex justify-end gap-2">
				<Button variant="secondary" onClick={() => onRespond(buildCancelResponse(req.id))}>
					取消 <Kbd>Esc</Kbd>
				</Button>
				<Button
					variant="primary"
					disabled={isOAuthCode && value.trim().length === 0}
					onClick={submit}
				>
					确认 <Kbd tone="onInk">Enter</Kbd>
				</Button>
			</div>
		</div>
	);
}

function EditorModalBody({
	req,
	onRespond,
}: {
	req: EditorUiRequest;
	onRespond: (res: ExtensionUiResponse) => void;
}) {
	const [value, setValue] = useState(req.prefill ?? "");

	useEffect(() => {
		setValue(req.prefill ?? "");
	}, [req.id, req.prefill]);

	const submit = () => {
		onRespond({ type: "extension_ui_response", id: req.id, value });
	};

	return (
		<div>
			<div className="mt-3">
				<textarea
					value={value}
					autoFocus
					onChange={e => setValue(e.target.value)}
					onKeyDown={e => {
						if (e.nativeEvent.isComposing || e.keyCode === 229) return;
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
							e.preventDefault();
							submit();
						}
					}}
					rows={7}
					aria-label={req.title}
					className={
						"max-h-[50vh] min-h-[160px] w-full resize-y rounded-control bg-inset p-2.5 " +
						"text-[12.5px] leading-[1.6] text-ink shadow-hairline outline-none focus:ring-1 focus:ring-line-strong " +
						(req.promptStyle ? "font-sans" : "font-mono")
					}
				/>
			</div>
			<div className="mt-4 flex items-center justify-between gap-2">
				<span className="text-[11.5px] text-ink-2">Ctrl+Enter 提交</span>
				<div className="flex items-center gap-2">
					<Button variant="secondary" onClick={() => onRespond(buildCancelResponse(req.id))}>
						取消 <Kbd>Esc</Kbd>
					</Button>
					<Button variant="primary" onClick={submit}>
						保存 <Kbd tone="onInk">Ctrl Enter</Kbd>
					</Button>
				</div>
			</div>
		</div>
	);
}

export interface UiRequestCardProps {
	request: ModalUiRequest;
	onRespond: (res: ExtensionUiResponse) => void;
}

/**
 * Pure card body for a modal UI request; rendered inside Radix Dialog in
 * `UiRequestLayer` and directly in gallery previews.
 */
export function UiRequestDialogCard({ request, onRespond }: UiRequestCardProps) {
	const timeoutMs = "timeout" in request ? request.timeout : undefined;

	return (
		<div
			style={{ width: request.method === "editor" ? 640 : 440, maxWidth: "100%" }}
			className="relative overflow-hidden rounded-window bg-surface p-4 shadow-overlay"
		>
			<TimeoutBar timeoutMs={timeoutMs} onTimeout={() => onRespond(buildTimeoutResponse(request.id))} />
			<div className="flex items-start justify-between gap-4">
				<div className="text-[14px] font-semibold text-ink">{request.title}</div>
				<IconButton size="sm" label="关闭" onClick={() => onRespond(buildCancelResponse(request.id))}>
					<X size={14} strokeWidth={2.2} className="i" />
				</IconButton>
			</div>

			{request.method === "select" && <SelectModalBody req={request} onRespond={onRespond} />}
			{request.method === "confirm" && <ConfirmModalBody req={request} onRespond={onRespond} />}
			{request.method === "input" && <InputModalBody req={request} onRespond={onRespond} />}
			{request.method === "editor" && <EditorModalBody req={request} onRespond={onRespond} />}
		</div>
	);
}

export interface UiRequestLayerProps {
	sessionId: string;
	/** Optional view override for gallery / unit testing */
	viewOverride?: SessionView;
	/** Render inline without fixed portal for gallery */
	inline?: boolean;
	onRespondOverride?: (response: ExtensionUiResponse) => void;
	/** Suppress `input` modal while SettingsDialog renders the inline OAuth login card (DESIGN §7.1). */
	suppressOAuthInput?: boolean;
}

/**
 * DESIGN §7.1 & FRONTEND §6.15 modal ExtensionUiRequest layer:
 * Renders non-approval `select`, `confirm`, `input`, and `editor` requests from
 * `view.pendingUi` in arrival order, one at a time, with a timeout countdown bar
 * and automatic `{cancelled: true, timedOut: true}` response on timeout.
 */
export function UiRequestLayer({
	sessionId,
	viewOverride,
	inline = false,
	onRespondOverride,
	suppressOAuthInput = false,
}: UiRequestLayerProps) {
	const storeView = useSessionView(sessionId);
	const answerUi = useAppStore(s => s.answerUi);
	const view = viewOverride ?? storeView;

	const activeRequest = view ? selectActiveModalUiRequest(view.pendingUi, { suppressOAuthInput }) : null;
	if (!activeRequest) return null;

	const handleRespond = (response: ExtensionUiResponse) => {
		if (onRespondOverride) {
			onRespondOverride(response);
			return;
		}
		answerUi(sessionId, response);
	};

	if (inline) {
		return <UiRequestDialogCard key={activeRequest.id} request={activeRequest} onRespond={handleRespond} />;
	}

	const timeoutMs = "timeout" in activeRequest ? activeRequest.timeout : undefined;
	const width = activeRequest.method === "editor" ? 640 : 440;

	return (
		<DialogPrimitive.Root
			key={activeRequest.id}
			open={true}
			onOpenChange={open => {
				if (!open) handleRespond(buildCancelResponse(activeRequest.id));
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay
					className={
						"fixed inset-0 z-50 bg-scrim " +
						"data-[state=open]:animate-[fade-in_0.18s] " +
						"data-[state=closed]:animate-[fade-in_0.12s_reverse]"
					}
				/>
				<DialogPrimitive.Content
					style={{ width, maxWidth: "calc(100vw - 32px)" }}
					className={
						"fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 overflow-hidden " +
						"rounded-window bg-surface p-4 shadow-overlay " +
						"focus-visible:rounded-window focus-visible:shadow-overlay " +
						"data-[state=open]:animate-[pop-in_0.18s_var(--ease-out-strong)] " +
						"data-[state=closed]:scale-[0.98] data-[state=closed]:opacity-0 " +
						"data-[state=closed]:transition-[opacity,transform] data-[state=closed]:duration-120"
					}
				>
					<TimeoutBar
						timeoutMs={timeoutMs}
						onTimeout={() => handleRespond(buildTimeoutResponse(activeRequest.id))}
					/>
					<div className="flex items-start justify-between gap-4">
						<DialogPrimitive.Title className="text-[14px] font-semibold text-ink">
							{activeRequest.title}
						</DialogPrimitive.Title>
						<DialogPrimitive.Close asChild>
							<IconButton size="sm" label="关闭">
								<X size={14} strokeWidth={2.2} className="i" />
							</IconButton>
						</DialogPrimitive.Close>
					</div>
					<DialogPrimitive.Description className="sr-only">
						{activeRequest.title}
					</DialogPrimitive.Description>

					{activeRequest.method === "select" && (
						<SelectModalBody req={activeRequest} onRespond={handleRespond} />
					)}
					{activeRequest.method === "confirm" && (
						<ConfirmModalBody req={activeRequest} onRespond={handleRespond} />
					)}
					{activeRequest.method === "input" && (
						<InputModalBody req={activeRequest} onRespond={handleRespond} />
					)}
					{activeRequest.method === "editor" && (
						<EditorModalBody req={activeRequest} onRespond={handleRespond} />
					)}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
