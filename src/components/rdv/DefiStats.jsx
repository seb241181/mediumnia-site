import { useEffect, useState } from 'react'

// Onglet Pilotage : suivi du Défi Intuition sur 30 jours (joueurs, parties,
// partages par réseau, inscrits au rappel). Réservé au propriétaire du site.

const SHARE_LABELS = { image: 'Stories (image)', facebook: 'Facebook', whatsapp: 'WhatsApp', copy: 'Texte copié', native: 'Menu du téléphone' }

export default function DefiStats({ session }) {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!session?.access_token) return
    let active = true
    fetch('/api/rdv-config?defiAction=stats', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
      .then(({ ok, data }) => { if (active) { if (ok) setStats(data); else setError(data.error === 'forbidden' ? '' : 'Statistiques du Défi indisponibles pour le moment.') } })
      .catch(() => { if (active) setError('Statistiques du Défi indisponibles pour le moment.') })
    return () => { active = false }
  }, [session?.access_token])

  if (error) return <p className="mt-8 font-georgia text-sm text-mist">{error}</p>
  if (!stats) return null

  const max = Math.max(1, ...stats.series.map((d) => d.plays))
  const tiles = [
    ['Nouveaux joueurs', stats.newPlayers],
    ['Parties jouées', stats.plays],
    ['Partages', stats.shareTotal],
    ['Inscrits au rappel', stats.subscribers],
  ]
  return (
    <section className="mt-10 rounded-3xl border border-gold/25 bg-white/75 p-6" aria-labelledby="defi-stats-title">
      <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Jeu gratuit · 30 derniers jours</p>
      <h2 id="defi-stats-title" className="mt-1 font-georgia text-2xl text-deep">Défi Intuition</h2>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-gold/20 bg-cream/60 p-4">
            <p className="font-georgia text-3xl text-deep" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
            <p className="mt-1 font-georgia text-xs text-mist">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex h-24 items-end gap-[3px]" role="img" aria-label="Parties jouées par jour sur 30 jours">
        {stats.series.map((d) => (
          <span key={d.date} title={`${d.date} : ${d.plays} partie${d.plays > 1 ? 's' : ''}`} className="flex-1 rounded-t bg-gold/70" style={{ height: `${Math.max(3, (d.plays / max) * 100)}%`, opacity: d.plays ? 1 : 0.25 }} />
        ))}
      </div>
      <p className="mt-2 font-georgia text-[11px] text-mist">Parties par jour</p>
      <ul className="mt-5 grid gap-1 font-georgia text-sm text-deep sm:grid-cols-2">
        {Object.entries(stats.shares).map(([channel, count]) => (
          <li key={channel} className="flex justify-between border-b border-gold/15 py-1.5"><span>{SHARE_LABELS[channel] || channel}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</span></li>
        ))}
      </ul>
    </section>
  )
}
