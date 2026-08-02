// The actual outline of Bosque County, Texas, from the US Census 20m
// cartographic boundary file (public domain), projected true-to-shape and
// simplified. Used as a quiet brand mark: a county-sized shape for a
// county-sized golf course. Coordinates are county-scale geography, which
// identifies nothing private.
export default function CountyShape({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 99.6"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M19.3 18.8L53.6 0.0L67.2 11.3L72.7 4.9L71.3 30.1L85.9 37.3L77.8 43.7L85.5 53.8L99.3 58.3L93.2 67.2L100.0 74.1L58.4 97.8L55.0 99.6L43.3 79.7L32.8 85.9L0.0 30.0L19.3 18.8Z" />
    </svg>
  )
}
