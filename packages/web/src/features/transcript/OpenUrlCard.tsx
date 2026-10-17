/**
 * OpenUrlCard component (DESIGN §7.1).
 * Inline card for `open_url` requests: Open button (`window.open(url)`) +
 * Copy button (`launchUrl ?? url`) + instructions.
 */
import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import { useState } from "react";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";

export interface OpenUrlCardProps {
	url: string;
	launchUrl?: string;
	instructions?: string;
}

export function OpenUrlCard({ url, launchUrl, instructions }: OpenUrlCardProps) {
	const [copied, setCopied] = useState(false);
	const copyTarget = launchUrl ?? url;

	const handleOpen = () => {
		if (typeof window !== "undefined") {
			window.open(url, "_blank", "noopener,noreferrer");
		}
	};

	const handleCopy = () => {
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			void navigator.clipboard.writeText(copyTarget);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<Card className="anim-fade-up my-1 p-3">
			<div className="flex items-center gap-2 text-[13px] font-medium text-ink">
				<Globe size={14} strokeWidth={2} className="i shrink-0 text-accent-ink" />
				<span>在浏览器中打开链接</span>
			</div>
			{instructions && (
				<div className="mt-1 text-[12.5px] text-ink-2 whitespace-pre-wrap">{instructions}</div>
			)}
			<div className="mt-2 truncate rounded-control bg-inset px-2.5 py-1.5 shadow-hairline mono text-[11.5px] text-ink-2">
				{copyTarget}
			</div>
			<div className="mt-2.5 flex items-center justify-end gap-2">
				<Button
					variant="secondary"
					size="md"
					onClick={handleCopy}
					icon={
						copied ? (
							<Check size={13} strokeWidth={2.5} className="i text-green" />
						) : (
							<Copy size={13} strokeWidth={2} className="i" />
						)
					}
				>
					{copied ? "已复制" : "复制链接"}
				</Button>
				<Button
					variant="primary"
					size="md"
					onClick={handleOpen}
					icon={<ExternalLink size={13} strokeWidth={2.2} className="i" />}
				>
					打开链接
				</Button>
			</div>
		</Card>
	);
}
