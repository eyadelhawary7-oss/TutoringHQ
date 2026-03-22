type Props = {
  size?: number;
};

export function SuccessCheckmark({ size = 20 }: Props) {
  return (
    <span
      className="micro-success-badge"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size * 0.6}
        height={size * 0.6}
        fill="none"
        stroke="white"
        strokeWidth="2.5"
        viewBox="0 0 24 24"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}
