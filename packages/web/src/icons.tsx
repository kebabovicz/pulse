// Line icons (lucide set), 12-15 px inside rows — DESIGN.md.
import type { SVGProps } from 'react'

function Svg({ size = 14, children, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

export const Check = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
)

export const Cross = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
)

export const Minus = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)

export const FolderPlus = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
    <path d="M12 11v6M9 14h6" />
  </Svg>
)

export const SignOut = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 16l4-4-4-4M20 12H9" />
  </Svg>
)

export const Warning = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M12 4 2.5 20h19L12 4Z" />
    <path d="M12 10v4M12 17.5v.5" />
  </Svg>
)

export const Pause = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M9 5v14M15 5v14" />
  </Svg>
)

export const Circle = (p: { size?: number }) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
  </Svg>
)

export const Spinner = (p: { size?: number }) => (
  <Svg {...p} className="spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </Svg>
)

export const Play = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="m7 4 13 8-13 8Z" />
  </Svg>
)

export const History = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </Svg>
)

export const ChevronDown = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

export const StopSquare = (p: { size?: number }) => (
  <Svg {...p}>
    <rect x="5" y="5" width="14" height="14" rx="1.5" />
  </Svg>
)

export const Repeat = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </Svg>
)

export const Copy = (p: { size?: number }) => (
  <Svg {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
)

export const GitCompare = (p: { size?: number }) => (
  <Svg {...p}>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <path d="M11 18H8a2 2 0 0 1-2-2V9" />
  </Svg>
)

export const Search = (p: { size?: number }) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
)

export const Eye = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

export const EyeOff = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M10.7 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2" />
    <path d="M6.6 6.6A16.7 16.7 0 0 0 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="m3 3 18 18" />
  </Svg>
)

export const ChevronsUpDown = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </Svg>
)

export const Upload = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M12 15V3" />
    <path d="m7 8 5-5 5 5" />
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
  </Svg>
)

export const MoreVertical = (p: { size?: number }) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </Svg>
)

export const PulseIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M4 17h5l2.5-7 4.5 13 3.5-9.5 1.5 3.5h7" />
  </svg>
)

export const Trash = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Svg>
)

export const ChevronsDownUp = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="m7 20 5-5 5 5" />
    <path d="m7 4 5 5 5-5" />
  </Svg>
)
