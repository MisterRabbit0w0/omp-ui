/**
 * omp-ui brand mark: π whose right shoulder is cut by a `>` prompt slit
 * (docs/brand/mark-v7). Fill follows `currentColor`.
 *
 * Two optical cuts share one outline: at ≤ 24px the slit is widened so it
 * survives rasterization; above that the fine slit is used.
 */
const MARK_PATH =
	"M171 183 L616 183 L699 245 L616 306 L528 306 C482 306 450 327 446 384 C439 512 426 649 417 754 C414 798 393 817 361 817 L187 817 C171 817 165 810 165 802 C165 792 174 786 187 783 C231 770 253 731 262 683 C277 603 295 466 301 386 C304 338 286 313 245 311 C197 309 151 318 119 326 C94 331 80 322 80 297 C80 229 107 183 171 183 Z M655 183 L886 183 C905 183 920 198 920 217 L920 272 C920 291 905 306 886 306 L795 306 C759 306 741 325 739 361 C738 489 745 643 767 712 C783 761 809 779 843 786 C856 789 864 795 864 803 C864 813 857 817 846 817 L672 817 C631 817 610 795 607 752 C600 649 598 512 603 421 C607 375 623 330 655 306 L737 245 Z";
const MARK_PATH_SMALL =
	"M171 183 L588 183 L686 245 L588 306 L528 306 C482 306 450 327 446 384 C439 512 426 649 417 754 C414 798 393 817 361 817 L187 817 C171 817 165 810 165 802 C165 792 174 786 187 783 C231 770 253 731 262 683 C277 603 295 466 301 386 C304 338 286 313 245 311 C197 309 151 318 119 326 C94 331 80 322 80 297 C80 229 107 183 171 183 Z M683 183 L886 183 C905 183 920 198 920 217 L920 272 C920 291 905 306 886 306 L795 306 C759 306 741 325 739 361 C738 489 745 643 767 712 C783 761 809 779 843 786 C856 789 864 795 864 803 C864 813 857 817 846 817 L672 817 C631 817 610 795 607 752 C600 649 598 512 603 421 C607 375 650 327 683 306 L781 245 Z";

interface BrandMarkProps {
	size?: number;
	className?: string;
	/** When set, the mark is announced with this label instead of being hidden. */
	title?: string;
}

export function BrandMark({ size = 16, className, title }: BrandMarkProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 1000 1000"
			fill="currentColor"
			className={className ?? "shrink-0"}
			role={title ? "img" : undefined}
			aria-label={title}
			aria-hidden={title ? undefined : true}
		>
			<path d={size <= 24 ? MARK_PATH_SMALL : MARK_PATH} />
		</svg>
	);
}
