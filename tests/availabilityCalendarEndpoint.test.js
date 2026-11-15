import test from 'node:test'; import assert from 'node:assert/strict';
import handler from '../api/availability-calendar-sync-test.js';
test('test endpoint is production-denied before any database work', async () => { const old = process.env.VERCEL_ENV; process.env.VERCEL_ENV='production'; let code; await handler({method:'POST',headers:{}},{status:n=>{code=n;return {json:()=>{}}}}); assert.equal(code,404); process.env.VERCEL_ENV=old })
