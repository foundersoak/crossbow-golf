import { NavLink, Outlet } from 'react-router-dom'

const TABS = [
  { to: '/', label: 'Map', icon: '⛳' },
  { to: '/rounds', label: 'Rounds', icon: '✎' },
  { to: '/boards', label: 'Boards', icon: '▤' },
  { to: '/more', label: 'More', icon: '≡' }
]

export default function Shell() {
  return (
    <div className="shell">
      <main className="shell-main">
        <Outlet />
      </main>
      <nav className="tab-bar">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) => (isActive ? 'tab tab-active' : 'tab')}
          >
            <span className="tab-icon" aria-hidden>
              {tab.icon}
            </span>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
