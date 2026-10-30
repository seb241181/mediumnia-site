import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FEATURED_INTERVIEW, SOCIAL_LINKS, chapterTime, youtubeEmbedUrl } from '../src/data/mediumiaMedia.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('the interview plays without advertising cookies, only after a click', () => {
  const embed = youtubeEmbedUrl(FEATURED_INTERVIEW.youtubeId, 1320)
  assert.match(embed, /^https:\/\/www\.youtube-nocookie\.com\/embed\/hbHb9BqAfrI\?/)
  assert.match(embed, /start=1320/)
  const ui = read('src/components/VideoInterview.jsx')
  assert.match(ui, /playing \? \(\s*<iframe/)
  assert.match(ui, /i\.ytimg\.com\/vi\/\$\{video\.youtubeId\}\/hqdefault\.jpg/)
  assert.match(read('vercel.json'), /frame-src https:\/\/\*\.paypal\.com https:\/\/www\.youtube-nocookie\.com;/)
})

test('chapters and view count stay truthful', () => {
  assert.equal(chapterTime(1320), '22:00')
  assert.equal(chapterTime(3660), '1:01:00')
  assert.ok(FEATURED_INTERVIEW.chapters.every((c, i, all) => i === 0 || c.start > all[i - 1].start))
  assert.match(FEATURED_INTERVIEW.viewsLabel, /Plus de 95 000 vues/)
})

test('social shortcuts: Facebook, Instagram and TikTok, in the footer of every page', () => {
  assert.deepEqual(SOCIAL_LINKS.map((l) => l.id), ['facebook', 'instagram', 'tiktok'])
  assert.ok(SOCIAL_LINKS.every((l) => l.href.startsWith('https://www.')))
  const footer = read('src/components/LegalFooter.jsx')
  assert.match(footer, /SOCIAL_LINKS\.map/)
  assert.match(footer, /target="_blank" rel="noopener noreferrer"/)
})

test('home displays only a small interview inside the consultation presentation; booking page retains the full interview', () => {
  const app = read('src/App.jsx')
  const consultations = read('src/components/ConsultationSection.jsx')
  const interview = read('src/components/VideoInterview.jsx')
  const patch = read('scripts/apply-home-growth-path.mjs')

  assert.doesNotMatch(app, /<VideoInterview id="videos"/)
  assert.doesNotMatch(app, /id: 'videos', label: 'Vidéos'/)
  assert.doesNotMatch(patch, /id: 'videos', label: 'Vidéos'/)
  assert.match(consultations, /import \{ InterviewMiniature \} from '\.\/VideoInterview'/)
  assert.match(consultations, /practitioner\.rdvSlug === 'sebastien-seguin' && <InterviewMiniature \/>/)
  assert.match(interview, /export function InterviewMiniature\(\)/)
  assert.match(interview, /aria-label="Voir ma présentation en vidéo"/)
  assert.match(interview, /playing \? \(\s*<iframe/)
  // Aucune nouvelle action de réservation n'est introduite dans la miniature.
  const mini = interview.slice(interview.indexOf('export function InterviewMiniature('), interview.indexOf('export default function VideoInterview('))
  assert.doesNotMatch(mini, /Prendre rendez-vous|onOpenRdv|SOCIAL_LINKS|chapters\.map/)
  assert.match(read('src/components/rdv/RdvPublic.jsx'), /slug === 'sebastien-seguin' && <div className="-mx-6"><VideoInterview id="interview-rdv" compact \/>/)
})
