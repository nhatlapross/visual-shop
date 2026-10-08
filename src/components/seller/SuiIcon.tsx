interface SuiIconProps {
  className?: string
}

/** Sui droplet in the brand blue. Approximation: swap in the official asset when we have it. */
export default function SuiIcon({ className }: SuiIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path
        d="M12 2C9.2 5.7 5.5 9 5.5 13.6a6.5 6.5 0 0 0 13 0C18.5 9 14.8 5.7 12 2Z"
        fill="#4DA2FF"
      />
      <path
        d="M8.3 13.2c1.2-1 2.4-1 3.6 0s2.4 1 3.6 0M8.3 16.2c1.2-1 2.4-1 3.6 0s2.4 1 3.6 0"
        stroke="#fff"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
