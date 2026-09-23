import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('ChronoSphère terms state the real prices and the digital-content withdrawal rule', () => {
  const legal = read('src/components/LegalPages.jsx')
  const cgv = legal.slice(legal.indexOf('export function CgvChronosphere'))
  const paypal = read('lib/chronospherePayPal.js')
  for (const [price, code] of [['5,00 €', "amount: '5.00'"], ['9,90 €', "amount: '9.90'"], ['19,90 €', "amount: '19.90'"]]) {
    assert.match(cgv, new RegExp(price))
    assert.ok(paypal.includes(code), `price ${price} must match the live PayPal amount`)
  }
  assert.match(cgv, /L\. 221-28, 13°/)
  assert.match(cgv, /garantie légale de conformité/)
  assert.match(cgv, /CM2C/)
})

test('ChronoSphère terms are reachable from the footer and the router', () => {
  assert.match(read('src/components/LegalFooter.jsx'), /href="\/cgv-chronosphere"/)
  assert.match(read('src/App.jsx'), /p === '\/cgv-chronosphere' \? 'cgv-chronosphere'/)
})
