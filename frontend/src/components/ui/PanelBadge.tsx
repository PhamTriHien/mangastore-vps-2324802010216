export interface PanelBadgeProps {
  asset: string;
  className?: string;
  alt?: string;
}

export function PanelBadge({
  asset,
  className = "h-5 w-5",
  alt = "",
}: PanelBadgeProps) {
  return (
    <img
      src={`/content/ui/badges/${asset}.svg`}
      alt={alt}
      className={`ms-asset-2d ${className}`}
      loading="lazy"
    />
  );
}
