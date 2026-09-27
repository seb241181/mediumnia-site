// Vidéos et réseaux de Sébastien Seguin affichés sur le site.
// Pour ajouter une vidéo : son identifiant YouTube (après « v= »), son titre,
// la chaîne et, si utile, quelques chapitres (secondes depuis le début).

export const FEATURED_INTERVIEW = {
  youtubeId: 'hbHb9BqAfrI',
  title: 'Médiumnité : connexions aux âmes et aux guides',
  channel: 'Nèche et Consciences',
  duration: '1 h 23',
  // Relevé le 27/09/2026 : 96 973 vues. Arrondi par le bas pour rester vrai.
  viewsLabel: 'Plus de 95 000 vues sur YouTube',
  chapters: [
    { label: 'La médiumnité, c’est quoi ?', start: 270 },
    { label: 'Comment se passe une séance ?', start: 1320 },
    { label: 'Canalisation en direct', start: 2614 },
    { label: 'Un médium peut-il se tromper ?', start: 3660 },
    { label: 'Je vis des perceptions différentes, que faire ?', start: 4140 },
  ],
}

export const SOCIAL_LINKS = [
  { id: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/profile.php?id=100089857152685' },
  { id: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/seguinmedium/' },
]

export function youtubeWatchUrl(id, start = 0) {
  return `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`
}

// Lecteur sans cookie publicitaire (youtube-nocookie), chargé seulement au clic.
export function youtubeEmbedUrl(id, start = 0) {
  const params = new URLSearchParams({ autoplay: '1', rel: '0', modestbranding: '1' })
  if (start) params.set('start', String(start))
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`
}

export function chapterTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
