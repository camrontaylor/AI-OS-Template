export function AiOsLogomark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect x="6" y="6" width="52" height="52" rx="14" stroke="currentColor" strokeWidth="4" />
      <path d="M20 42L28 22H36L44 42" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 34H40" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
