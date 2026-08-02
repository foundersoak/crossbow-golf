// Architect's credit in the tradition of course design callouts —
// the way a Fazio or Dye course says so on the card. Sits at the foot
// of list pages, pushed into whatever space the content leaves.
export default function Colophon() {
  return (
    <footer className="colophon">
      <span className="colophon-orn" aria-hidden>
        ✦ ✦ ✦
      </span>
      <span className="colophon-credit">A Russell Jordan Design</span>
      <span className="colophon-sub">The Links at Crossbow Ranch · Bosque County, Texas</span>
    </footer>
  )
}
