export interface MangaIconProps {
  name: string;
  className?: string;
}

export function MangaIcon({ name, className = "h-5 w-5" }: MangaIconProps) {
  return (
    <svg
      className={`inline-block shrink-0 ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <use href={`/content/icons/manga-icons-2d.svg#ms-icon-${name}`} />
    </svg>
  );
}
