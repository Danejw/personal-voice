/** Circle and three bars used beside Personal Voice and as the app icon. */
export function BrandMark({ className }: { className?: string }) {
  const name = className ? `brand-mark ${className}` : "brand-mark";
  return (
    <svg className={name} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10v4M12 7v10M16 10v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
