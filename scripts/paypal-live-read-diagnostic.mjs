/* global process, Buffer, fetch, AbortSignal */
if (!(process.env.VERCEL_ENV === 'production' && process.env.PAYPAL_LIVE_READ_DIAGNOSTIC === 'run')) process.exit(0)
const out = (v) => console.info(`PAYPAL_LIVE_READ_DIAGNOSTIC ${JSON.stringify(v)}`)
const e = (k) => String(process.env[k] || '').trim()
const url=e('SUPABASE_URL'), key=e('SUPABASE_SERVICE_ROLE_KEY'), id=e('PAYPAL_CLIENT_ID'), secret=e('PAYPAL_CLIENT_SECRET')
if (!url||!key||!id||!secret||e('PAYPAL_RDV_DEPOSIT_ENV')!=='live') { out({stage:'configuration'}); process.exit(0) }
try {
 const q=new URL('/rest/v1/rdv_paypal_payments',url);q.searchParams.set('select','paypal_order_id');q.searchParams.set('paypal_env','eq.live');q.searchParams.set('paypal_order_id','like.*7357');q.searchParams.set('limit','2')
 const db=await fetch(q,{headers:{apikey:key,Authorization:`Bearer ${key}`}});const rows=await db.json();if(!db.ok||!Array.isArray(rows)||rows.length!==1){out({stage:'lookup',httpStatus:db.status});process.exit(0)}
 const auth=await fetch('https://api-m.paypal.com/v1/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(20_000)});const tok=(await auth.json()).access_token;if(!auth.ok||!tok){out({stage:'oauth',httpStatus:auth.status});process.exit(0)}
 const r=await fetch(`https://api-m.paypal.com/v2/checkout/orders/${encodeURIComponent(rows[0].paypal_order_id)}`,{headers:{Authorization:`Bearer ${tok}`},signal:AbortSignal.timeout(20_000)});let data=null;try{data=await r.json()}catch{}
 const has=(k)=>Object.prototype.hasOwnProperty.call(data||{},k)?(Array.isArray(data[k])?'array':typeof data[k]):'absent'
 out({stage:'order',httpStatus:r.status,contentType:r.headers.get('content-type')||null,jsonType:Array.isArray(data)?'array':data===null?'invalid-or-empty':typeof data,topLevel:data&&typeof data==='object'&&!Array.isArray(data)?Object.keys(data).sort():[],status:has('status'),id:has('id'),purchase_units:has('purchase_units'),name:has('name')})
}catch(error){out({stage:'transport',category:error?.name==='TimeoutError'?'timeout':'network_error'})}
