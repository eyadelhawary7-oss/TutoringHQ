interface SuccessCheckProps {
  size?: number;
  color?: string;
  className?: string;
}

export function SuccessCheck({ size = 48, color = '#0D9488', className = '' }: SuccessCheckProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="22" stroke={color} strokeWidth="2.5" opacity="0.2" />
      <circle
        cx="24"
        cy="24"
        r="22"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray="138"
        strokeDashoffset="138"
        style={{ animation: 'chq-check-draw 500ms cubic-bezier(0.22,1,0.36,1) 100ms forwards' }}
      />
      <polyline
        points="14,25 21,32 34,17"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="chq-check-path"
        style={{ animationDelay: '300ms' }}
      />
    </svg>
  );
}
