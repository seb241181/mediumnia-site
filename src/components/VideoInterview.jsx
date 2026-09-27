import { useState } from 'react'
import { FEATURED_INTERVIEW, SOCIAL_LINKS, chapterTime, youtubeEmbedUrl, youtubeWatchUrl } from '../data/mediumiaMedia.js'

// « Sébastien en interview » : l'image de la vidéo s'affiche d'abord ; le
// lecteur YouTube (sans cookie publicitaire) ne se charge qu'au clic.

export function FacebookIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.4H8v3h2.6V21h2.9z" />
    </svg>
  )
}

export function InstagramIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function TikTokIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M16.6 3c.3 2.2 1.6 3.6 3.9 3.8v2.7c-1.4.1-2.6-.3-3.9-1.1v5.2c0 3.5-2.4 5.9-5.8 5.9-3.1 0-5.4-2.4-5.4-5.3 0-3.3 2.8-5.7 6.3-5.2v2.8c-1.6-.4-3.4.6-3.4 2.4 0 1.4 1.1 2.5 2.5 2.5 1.6 0 2.7-1.1 2.7-3.1V3h3.1z" />
    </svg>
  )
}

export function SocialIcon({ id, className }) {
  if (id === 'facebook') return <FacebookIcon className={className} />
  if (id === 'tiktok') return <TikTokIcon className={className} />
  if (id === 'instagram') return <InstagramIcon className={className} />
  return null
}

export default function VideoInterview({ id = 'interview', onOpenRdv, compact = false }) {
  const video = FEATURED_INTERVIEW
  const [start, setStart] = useState(null)
  const playing = start !== null

  function play(from = 0) {
    setStart(from)
    document.getElementById(`${id}-player`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <section id={id} className={`mx-auto max-w-6xl scroll-mt-28 px-6 ${compact ? 'pt-14' : 'py-14'}`} aria-labelledby={`${id}-title`}>
      <div className={compact ? '' : 'mx-auto mb-8 max-w-2xl text-center'}>
        <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">Sébastien en interview</p>
        <h2 id={`${id}-title`} className={`mt-2 font-georgia font-medium leading-tight text-deep ${compact ? 'text-2xl' : 'text-3xl md:text-4xl'}`}>
          {compact ? 'Découvrez sa façon de travailler' : 'Écoutez Sébastien parler de la médiumnité'}
        </h2>
        {!compact && (
          <p className="mt-3 font-georgia leading-relaxed text-mist">
            Son parcours, le déroulement d’une séance, une canalisation en direct : une heure pour faire connaissance avant de prendre rendez-vous.
          </p>
        )}
      </div>

      <div className={`grid gap-6 ${compact ? 'mt-6' : ''} lg:grid-cols-[1.6fr_1fr] lg:items-start`}>
        <div id={`${id}-player`} className="relative aspect-video overflow-hidden rounded-3xl border border-gold/30 bg-deep shadow-[0_18px_45px_rgba(26,21,53,.12)]">
          {playing ? (
            <iframe
              src={youtubeEmbedUrl(video.youtubeId, start)}
              title={`${video.title} — ${video.channel}`}
              className="absolute inset-0 h-full w-full"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <button type="button" onClick={() => play(0)} className="group absolute inset-0 block h-full w-full text-left" aria-label={`Lire la vidéo : ${video.title}`}>
              <img
                src={`https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-deep/80 via-deep/10 to-transparent" aria-hidden="true" />
              <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gold text-deep shadow-lg transition-transform group-hover:scale-105" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              </span>
              <span className="absolute bottom-4 left-5 right-5 font-georgia text-sm text-cream">
                <strong className="block text-base font-medium">{video.title}</strong>
                {video.channel} · {video.duration} · {video.viewsLabel}
              </span>
            </button>
          )}
        </div>

        <div className="rounded-3xl border border-gold/25 bg-white/75 p-6">
          <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">Aller directement à</p>
          <ul className="mt-3 divide-y divide-gold/15">
            {video.chapters.map((chapter) => (
              <li key={chapter.start}>
                <button type="button" onClick={() => play(chapter.start)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left font-georgia text-sm text-deep hover:text-gold">
                  <span>{chapter.label}</span>
                  <span className="shrink-0 tabular-nums text-xs text-mist">{chapterTime(chapter.start)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col gap-3">
            {onOpenRdv && (
              <button type="button" onClick={onOpenRdv} className="rounded-full bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold">
                Prendre rendez-vous avec Sébastien →
              </button>
            )}
            <a href={youtubeWatchUrl(video.youtubeId)} target="_blank" rel="noopener noreferrer" className="self-start font-georgia text-xs text-mist underline decoration-gold/40 underline-offset-4 hover:text-deep">Voir l’interview sur YouTube ↗</a>
            <p className="border-t border-gold/15 pt-3 font-georgia text-xs text-mist">Suivre Sébastien :</p>
            <div className="-mt-1 flex flex-wrap items-center gap-x-5 gap-y-2 font-georgia text-xs text-mist">
              {SOCIAL_LINKS.map((link) => (
                <a key={link.id} href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 underline decoration-gold/40 underline-offset-4 hover:text-deep">
                  <SocialIcon id={link.id} className="h-3.5 w-3.5" />{link.label} ↗
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
