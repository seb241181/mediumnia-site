import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { oracleStoryText } from '../src/lib/oracleShareImage.js'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Oracle story uses the real three cards and a 1080x1920 social format', () => {
  const image = read('src/lib/oracleShareImage.js')
  const page = read('src/components/OracleTest.jsx')
  assert.match(image, /const W = 1080/)
  assert.match(image, /const H = 1920/)
  assert.match(image, /\/images\/oracle\/\$\{card\?\.id\}\.png/)
  assert.match(image, /OMBRE.*PASSAGE.*GUÉRISON/s)
  assert.match(image, /mediumia\.fr\/oracle/)
  assert.match(page, /drawOracleStoryImage/)
  assert.match(page, /navigator\.canShare\?\.\(\{ files: \[file\] \}\)/)
  assert.match(page, /trackMediumiaMetric\('oracle_shared', 'oracle'\)/)

  const text = oracleStoryText([
    { name: "L'Ancienne" },
    { name: "La Porte d'Aube" },
    { name: "L'Alignement Intérieur" },
  ])
  assert.match(text, /L'Ancienne · La Porte d'Aube · L'Alignement Intérieur/)
  assert.match(text, /https:\/\/mediumia\.fr\/oracle/)
})

test('Oracle shares are admitted to analytics and displayed in Pilotage', () => {
  const funnel = read('scripts/apply-funnel-measurement.mjs')
  const pilotage = read('scripts/apply-oracle-email-sequence-pilotage.mjs')
  assert.match(funnel, /'oracle_shared'/)
  assert.match(funnel, /oracle_shared: 'Tirages Oracle partagés'/)
  assert.match(funnel, /const oracleShared = Number\(totals\.oracle_shared \|\| 0\)/)
  assert.match(pilotage, /label="Tirage partagé" value=\{oracleShared\}/)
})
