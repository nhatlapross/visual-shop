import suiLogo from '@/assets/sui-logo.svg'

interface SuiIconProps {
  className?: string
}

/** The official Sui mark. Decorative: the amount beside it always spells out "SUI". */
export default function SuiIcon({ className }: SuiIconProps) {
  return <img src={suiLogo} alt="" className={className} />
}
