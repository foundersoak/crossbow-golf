// Engraved folk-medallion brand mark: fine ink rings, letterspaced serif
// text arcing over the top, and the actual Bosque County outline (US
// Census public domain boundary) as the central emblem. All vector.

const COUNTY_PATH =
  'M19.3 18.8L53.6 0.0L67.2 11.3L72.7 4.9L71.3 30.1L85.9 37.3L77.8 43.7L85.5 53.8L99.3 58.3L93.2 67.2L100.0 74.1L58.4 97.8L55.0 99.6L43.3 79.7L32.8 85.9L0.0 30.0L19.3 18.8Z'

export default function CountyMedallion({ className }: { className?: string }) {
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5)
  const hatches = Array.from({ length: 40 }, (_, i) => 62 + i * 6)
  return (
    <svg
      className={className}
      viewBox="0 0 360 360"
      role="img"
      aria-label="Crossbow Ranch Pitch 'n Putt, Bosque County, Texas"
    >
      <defs>
        {/* Top semicircle, drawn clockwise so text reads upright. */}
        <path id="medal-arc-top" d="M 28 180 A 152 152 0 0 1 332 180" />
        <clipPath id="medal-clip">
          <circle cx="180" cy="180" r="126" />
        </clipPath>
      </defs>

      <circle className="medal-ring" cx="180" cy="180" r="177" strokeWidth="2.5" />
      <circle className="medal-ring" cx="180" cy="180" r="171" strokeWidth="1" />
      <circle className="medal-ring" cx="180" cy="180" r="133" strokeWidth="1" />
      <circle className="medal-ring" cx="180" cy="180" r="127.5" strokeWidth="2" />

      <g className="medal-ticks">
        {ticks.map((deg) => (
          <line
            key={deg}
            x1="180"
            y1="9"
            x2="180"
            y2="13.5"
            transform={`rotate(${deg} 180 180)`}
          />
        ))}
      </g>

      <g clipPath="url(#medal-clip)">
        <g className="medal-hatch">
          {hatches.map((y) => (
            <line key={y} x1="40" y1={y} x2="320" y2={y} />
          ))}
        </g>
        <g transform="translate(75 75.4) scale(2.1)">
          <path className="medal-fill" d={COUNTY_PATH} />
        </g>
      </g>

      <text className="medal-text">
        <textPath href="#medal-arc-top" startOffset="50%" textAnchor="middle">
          CROSSBOW RANCH ✦ PITCH N PUTT
        </textPath>
      </text>

      {/* Bottom ornaments in place of inverted ring text. */}
      <g className="medal-orn">
        <text x="104" y="316" textAnchor="middle">✦</text>
        <text x="180" y="336" textAnchor="middle">✦</text>
        <text x="256" y="316" textAnchor="middle">✦</text>
      </g>
    </svg>
  )
}
