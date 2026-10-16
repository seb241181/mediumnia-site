import { REQUEST_STATUSES } from './rdvCoulissesHelpers.js'

export default function RequestShortcuts({ counts, selected, onSelect }) {
  return (
    <nav aria-label="Accès direct aux demandes de rendez-vous" className="flex flex-wrap items-center gap-2 border-y border-gold/20 py-3">
      <button type="button" onClick={() => onSelect('all')} aria-pressed={selected === 'all'}
        className="min-h-11 px-2 py-2 font-georgia text-sm font-semibold text-deep">Demandes de rendez-vous</button>
      <div className="flex flex-wrap gap-1" aria-label="Statut des demandes">
        {REQUEST_STATUSES.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={selected === value} onClick={() => onSelect(value)}
            className={`min-h-11 rounded-lg border px-3 py-2 font-georgia text-xs ${selected === value ? 'border-deep bg-deep text-white' : 'border-gold/25 text-deep'}`}>
            {label} <span className="ml-1 font-semibold">{Number.isSafeInteger(counts?.[value]) ? counts[value] : '—'}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
