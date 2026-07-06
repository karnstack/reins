import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" fill="none" aria-hidden="true" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient
          id="reins-mark-bg"
          x1="16"
          y1="6"
          x2="110"
          y2="122"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#7C83FF" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="124" height="124" rx="30" fill="url(#reins-mark-bg)" />
      <path
        d="M42 42 C 42 80, 86 48, 86 86"
        stroke="#FFFFFF"
        strokeWidth="12"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="42" cy="42" r="13" fill="#FFFFFF" />
      <circle cx="86" cy="86" r="13" fill="#FFFFFF" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark className="size-6" />
      <span className="font-display text-lg font-semibold tracking-tight">reins</span>
    </span>
  );
}
