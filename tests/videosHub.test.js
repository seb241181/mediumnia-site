import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('public videos hub is routed and discoverable', () => {
  const app = read('src/App.jsx')
  const page = read('src/components/VideosPage.jsx')
  const interview = read('src/components/VideoInterview.jsx')
  const footer = read('src/components/LegalFooter.jsx')

  assert.match(app, /VideosPage/)
  assert.match(app, /p === '\/videos'/)
  assert.match(page, /data-videos-hub="v1"/)
  assert.match(page, /Je réponds à vos questions sur la médiumnité/)
  assert.match(page, /La première vidéo est en préparation/)
  assert.match(interview, /Accéder à la rubrique Vidéos/)
  assert.doesNotMatch(interview, /Vos questions · mes réponses/)
  assert.doesNotMatch(interview, /La prochaine vidéo partira de vos questions/)
  assert.match(app, /id="videos"/)
  assert.match(app, /label: 'Vidéos'/)
  assert.match(footer, /href="\/videos"/)
})

test('videos route gets dedicated SEO and prerendering', () => {
  const seo = read('scripts/apply-route-seo-cro.mjs')
  const prerender = read('scripts/prerender-route-meta.mjs')

  assert.match(seo, /videos: \{/)
  assert.match(seo, /Vidéos sur la médiumnité/)
  assert.match(prerender, /videos: '\/videos'/)
})
