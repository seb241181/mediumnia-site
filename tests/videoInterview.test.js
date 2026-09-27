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

test('social shortcuts: Facebook and Instagram, in the footer of every page', () => {
  assert.deepEqual(SOCIAL_LINKS.map((l) => l.id), ['facebook', 'instagram'])
  assert.ok(SOCIAL_LINKS.every((l) => l.href.startsWith('https://www.')))
  const footer = read('src/components/LegalFooter.jsx')
  assert.match(footer, /SOCIAL_LINKS\.map/)
  assert.match(footer, /target="_blank" rel="noopener noreferrer"/)
})

test('the interview sits after the reviews on the home page and on Sébastien’s booking page', () => {
  const app = read('src/App.jsx')
  assert.ok(app.indexOf('<ReviewsHighlight />') < app.indexOf('<VideoInterview id="interview"'))
  assert.ok(app.indexOf('<VideoInterview id="interview"') < app.indexOf('<DiscoverSection id="decouvrir"'))
  assert.match(app, /onOpenRdv\('sebastien-seguin'\)/)
  assert.match(read('src/components/rdv/RdvPublic.jsx'), /slug === 'sebastien-seguin' && <div className="-mx-6"><VideoInterview id="interview-rdv" compact \/>/)
})
