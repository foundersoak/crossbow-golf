export default function StubScreen({ title, note }: { title: string; note: string }) {
  return (
    <div className="page">
      <header className="page-head">
        <h1>{title}</h1>
      </header>
      <p className="muted">{note}</p>
    </div>
  )
}
