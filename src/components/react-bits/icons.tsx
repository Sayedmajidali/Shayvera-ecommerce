/**
 * Hugeicons → lucide adapter for the React Bits components, so the store ships one icon library.
 * `<HugeiconsIcon icon={X} size strokeWidth fill />` keeps the components' original call sites.
 */
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  Star,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type IconSvgElement = LucideIcon;

export const ArrowLeft01Icon = ChevronLeft;
export const ArrowRight01Icon = ChevronRight;
export const ArrowUpRight01Icon = ArrowUpRight;
export const Cancel01Icon = X;
export const Tick02Icon = Check;
export const FavouriteIcon = Heart;
export const FlashIcon = Zap;
export const StarIcon = Star;

export function HugeiconsIcon({
  icon: Icon,
  size = 24,
  strokeWidth = 2,
  fill,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
  fill?: string;
  className?: string;
}) {
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      fill={fill ?? "none"}
      className={className}
      aria-hidden
    />
  );
}
