import { useEffect, useState } from 'react'

// Nombre de visites du site MediumIA, lu en agrégé (aucune donnée de visiteur).
// Sur les pages publiques, le chiffre ne s'affiche qu'à partir d'un seuil.

export const PUBLIC_VISITS_THRESHOLD = 1000

function monthYear(date) {
  const d = new Date(`${date}T12:00:00Z`)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }) : ''
}

export function useSiteVisits() {
  const [stats, setStats] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/rdv-config?analyticsAction=public-stats')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (!cancelled && body) setStats(body) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return stats
}

// Bandeau pour la page « Rejoindre le Réseau ».
export default function SiteVisitsCounter({ threshold = PUBLIC_VISITS_THRESHOLD }) {
  const stats = useSiteVisits()
  if (!stats || Number(stats.visits || 0) < threshold) return null
  return (
    <div className="mb-12 rounded-2xl border border-gold/25 bg-white/70 px-6 py-5 text-center">
      <p className="font-georgia text-3xl font-medium text-deep md:text-4xl" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {Number(stats.visits).toLocaleString('fr-FR')}
      </p>
      <p className="mt-1 font-georgia text-sm text-mist">
        visites sur MediumIA depuis {monthYear(stats.since)} : autant de personnes qui peuvent découvrir votre pratique.
      </p>
    </div>
  )
}

// Carte pour le Pilotage : toujours affichée, avec la date de départ.
export function SiteVisitsPilotageCard() {
  const stats = useSiteVisits()
  return (
    <section className="rounded-2xl border border-gold/25 bg-white/75 p-6">
      <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Visiteurs du site</p>
      <p className="mt-2 font-georgia text-4xl font-medium text-deep" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {stats ? Number(stats.visits || 0).toLocaleString('fr-FR') : '…'}
      </p>
      <p className="mt-1 font-georgia text-xs text-mist">
        {stats?.since ? `visites depuis le ${new Date(`${stats.since}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })}` : 'visites'}
        {' · '}affiché sur « Rejoindre le Réseau » à partir de {PUBLIC_VISITS_THRESHOLD.toLocaleString('fr-FR')}
      </p>
      <p className="mt-3 font-georgia text-[10px] leading-relaxed text-mist/70">
        Une visite = une personne qui arrive sur le site, quelle que soit la page, comptée une seule fois par visite ; robots et espaces de gestion exclus. Avant la mise en place de ce compteur, ce sont les visites de l’accueil qui sont reprises.
      </p>
    </section>
  )
}
