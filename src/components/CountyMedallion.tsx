// Engraved folk-medallion brand mark: fine ink rings, letterspaced serif
// text arcing over the top, and the actual Bosque County outline (US
// Census TIGERweb boundary, Douglas-Peucker simplified) as the central
// emblem, filled with an engraved ranch-landscape etching and stroked so
// the county line still reads at small sizes.

const COUNTY_PATH =
  'M99.9 60.3L99.7 59.4L99.2 58.8L98.1 58.4L96.7 58.2L96.3 58.0L95.2 58.1L93.2 59.0L93.0 59.1L92.6 59.0L92.4 58.7L91.8 57.8L91.1 57.2L89.5 56.1L88.2 55.3L87.7 55.1L87.2 55.2L85.4 54.3L85.1 53.9L85.0 53.1L85.2 52.6L85.5 52.2L86.0 52.0L87.2 52.1L87.6 52.0L88.1 51.8L88.5 51.5L88.6 51.3L88.5 51.1L86.4 49.9L84.7 49.0L83.2 48.0L82.7 48.0L82.0 48.3L81.7 48.3L81.3 48.0L79.9 45.9L78.6 45.6L77.6 44.8L77.7 44.2L78.7 43.5L79.3 42.7L82.4 40.9L83.2 40.3L84.5 38.9L85.2 38.5L85.8 37.9L86.1 37.1L86.1 36.8L85.9 36.3L85.6 35.8L82.5 35.7L82.2 35.5L81.6 34.5L80.9 33.6L80.5 33.3L80.0 32.7L79.9 32.2L79.8 29.7L79.4 28.9L78.9 28.9L78.4 29.2L78.2 29.4L78.0 30.1L77.3 31.1L76.5 31.5L72.8 31.8L72.4 31.7L71.6 31.1L71.2 30.6L71.1 30.0L71.1 28.8L71.3 27.1L71.3 26.5L70.4 23.8L70.6 23.2L71.2 22.5L72.5 20.5L73.3 19.5L73.4 18.7L73.1 17.7L71.2 15.4L70.6 14.1L69.9 12.8L69.7 11.8L69.9 11.2L70.1 10.9L72.6 10.0L73.6 9.5L74.0 8.4L74.6 8.0L75.3 6.9L75.0 6.1L74.5 5.6L72.9 5.5L71.6 5.6L70.9 5.9L70.1 6.9L68.9 7.2L68.2 7.1L67.8 7.3L67.5 7.8L67.5 8.8L67.7 9.8L67.8 10.3L68.2 10.8L68.2 11.1L68.0 11.5L67.6 11.8L67.2 11.9L66.3 11.7L64.2 10.8L62.0 9.4L60.1 9.3L59.8 9.1L59.7 8.8L59.7 8.5L60.4 7.6L60.5 7.3L60.0 6.6L60.1 5.4L60.0 5.0L59.8 4.8L59.3 4.4L58.9 4.3L58.6 4.3L56.4 5.4L55.9 5.4L55.4 5.1L55.3 4.8L55.4 4.4L56.7 3.6L57.0 3.1L56.9 1.9L56.6 1.2L56.4 0.9L55.6 0.5L54.3 0.5L53.6 0.6L53.0 0.5L52.1 0.5L51.4 0.0L42.1 5.7L42.0 5.9L36.4 9.1L21.2 18.3L0.1 30.6L32.8 86.3L43.3 80.1L54.9 100.0L58.3 98.2L71.7 90.6L72.9 89.8L84.9 83.1L99.8 74.5L98.2 73.7L97.2 72.9L96.0 72.5L95.3 72.0L94.3 70.3L93.5 69.2L93.1 67.6L93.2 67.1L94.0 66.8L95.5 65.6L97.7 63.0L99.2 62.0L99.7 61.2Z'

export default function CountyMedallion({ className }: { className?: string }) {
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5)
  const hatches = Array.from({ length: 40 }, (_, i) => 62 + i * 6)
  return (
    <svg
      className={className}
      viewBox="0 0 360 360"
      role="img"
      aria-label="The Links at Crossbow Ranch, Bosque County, Texas"
    >
      <defs>
        {/* Top semicircle, drawn clockwise so text reads upright. */}
        <path id="medal-arc-top" d="M 28 180 A 152 152 0 0 1 332 180" />
        <clipPath id="medal-clip">
          <circle cx="180" cy="180" r="126" />
        </clipPath>
        <clipPath id="medal-county-clip">
          <path d={COUNTY_PATH} />
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
          {/* Solid silhouette beneath the etching so the emblem still reads
              if the artwork has not loaded yet. */}
          <path className="medal-fill" d={COUNTY_PATH} />
          <image
            href="/medallion-art.png"
            width="100"
            height="100"
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#medal-county-clip)"
          />
          <path className="medal-outline" d={COUNTY_PATH} vectorEffect="non-scaling-stroke" />
        </g>
      </g>

      <text className="medal-text">
        <textPath href="#medal-arc-top" startOffset="50%" textAnchor="middle">
          THE LINKS AT CROSSBOW RANCH
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
