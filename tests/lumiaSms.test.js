import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseLumiaSmsCommand, maybeHandleLumiaSmsChat } from '../lib/lumiaSmsChat.js'
import { handleLumiaSmsOutboxApi } from '../lib/lumiaSmsOutbox.js'
import { validateApprovedSms, outgoingFound, processApprovedSmsOnce, assertApprovedOutboxEndpoint, callOutbox } from '../tools/lumia-messages-bridge/src/outbox.js'

const id = '01234567-1234-4123-8123-123456789012'
const num = '+33612345678'
const body = 'Bonjour, votre rendez-vous est maintenu jeudi.'

test('commandes SMS : aucune action implicite, numéro exact et GO explicite', () => {
  assert.equal(parseLumiaSmsCommand('Réponds à Sophie').kind,'none')
  assert.equal(parseLumiaSmsCommand('GO #ABC123').kind,'none')
  assert.equal(parseLumiaSmsCommand('GO SMS #ABC123').kind,'approve')
  assert.deepEqual(parseLumiaSmsCommand('STATUT SMS #ABC123'),{kind:'status',code:'#ABC123'})
  assert.deepEqual(parseLumiaSmsCommand('SMS à 06 12 34 56 78 : Salut Sophie'),
    { kind:'draft', recipient:num, body:'Salut Sophie' })
  assert.equal(parseLumiaSmsCommand('SMS à 0600000000 : Salut').kind,'draft')
  assert.equal(parseLumiaSmsCommand('SMS à 1234 : test').kind,'none')
  assert.equal(parseLumiaSmsCommand(`SMS à ${num} : ${'a'.repeat(1001)}`).kind,'invalid')
  assert.equal(parseLumiaSmsCommand(`SMS à ${num} : salut\u0007`).kind,'invalid')
})

test('Mac : refus sans numéro explicitement autorisé, validation du canal et du texte', () => {
  const job = { id, recipient:num, channel:'sms', body }
  assert.equal(validateApprovedSms(job),'recipient_not_allowed')
  assert.equal(validateApprovedSms(job, { allowedHandles:[num] }),null)
  assert.equal(validateApprovedSms(job, {allowAll:true}),null)
  assert.equal(validateApprovedSms({ ...job,recipient:'../any' }, {allowAll:true}),'invalid_recipient')
  assert.equal(validateApprovedSms({ ...job,channel:'rcs' }, {allowAll:true}),'unsupported_channel')
  assert.equal(validateApprovedSms({ ...job,body:'' }, {allowAll:true}),'invalid_body')
})

test('Mac : confirmation basée sur message réellement retrouvé dans le bon fil', () => {
  const job={ id, recipient:num, channel:'sms', body }
  assert.equal(outgoingFound([{is_from_me:1,handle:num,text:body}],job),true)
  assert.equal(outgoingFound([{is_from_me:1,handle:'+33699999999',text:body}],job),false)
  assert.equal(outgoingFound([{is_from_me:0,handle:num,text:body}],job),false)
  assert.equal(outgoingFound([{is_from_me:1,handle:num,text:'autre texte'}],job),false)
  assert.equal(outgoingFound([{is_from_me:1,handle:null,chat_identifier:num,text:body}],job),true)
})

test('Mode interdit dans MediumIA : le chat ne crée aucun intent', async () => {
  let called=false
  const db={ from(){called=true;throw new Error('should not access DB')} }
  const result=await maybeHandleLumiaSmsChat({
    db,userId:id,conversationId:id,message:`SMS à ${num} : Bonjour`,env:{},
  })
  assert.match(result.reply,/désactivé/)
  assert.equal(called,false)
})

test('API Mac : refus sans flag, sans secret et sans méthode connue', async () => {
  const token='s'.repeat(64)
  const req={method:'GET',headers:{ authorization:`Bearer ${token}`}}
  assert.equal((await handleLumiaSmsOutboxApi({req,env:{LUMIA_SMS_OUTBOX_TOKEN:token}})).status,503)
  assert.equal((await handleLumiaSmsOutboxApi({req,env:{LUMIA_SMS_OUTBOX_ENABLED:'true'}})).status,503)
  assert.equal((await handleLumiaSmsOutboxApi({
    req:{...req,headers:{authorization:'Bearer bad'}},
    env:{LUMIA_SMS_OUTBOX_ENABLED:'true',LUMIA_SMS_OUTBOX_TOKEN:token},
  })).status,401)
})

test('Lumia : le brouillon reste une action privée ; seul GO SMS crée la file', async () => {
  const now = new Date('2026-11-24T18:00:00Z')
  const source = { id, source_conversation_id:'conv-fictif', source_channel:'sms', message_sent_at:'2026-11-24T17:55:00Z' }
  const trace = []
  const intent = { id, short_code:'#ABC123', status:'preview',
    preview_expires_at:'2026-11-24T18:10:00Z',
    canonical_payload:{ version:1, recipient:num, body, channel:'sms', source_inbox_id:id, source_conversation_id:source.source_conversation_id } }
  const db = {
    from(table) {
      const chain={
        select(){return chain},eq(){return chain},in(){return chain},order(){return chain},limit(){return Promise.resolve({data:[source],error:null})},
        maybeSingle(){return Promise.resolve({data:intent,error:null})},
        insert(value){trace.push({table,value});return Promise.resolve({data:null,error:null})},
      }
      return chain
    },
    async rpc(name,args) {
      trace.push({name,args})
      if(name==='lumia_create_action_intent') return {data:{short_code:'#ABC123'},error:null}
      if(name==='lumia_approve_action_intent') return {data:{status:'approved'},error:null}
      if(name==='lumia_claim_action_execution') return {data:{status:'executing'},error:null}
      if(name==='lumia_finish_action_execution') return {data:{status:'succeeded'},error:null}
      return {data:null,error:{message:'unknown rpc'}}
    },
  }
  const draft=await maybeHandleLumiaSmsChat({
    db,userId:id,conversationId:id,message:`SMS à ${num} : ${body}`,
    env:{LUMIA_SMS_SEND_ENABLED:'true'},now,
  })
  assert.match(draft.reply,/RIEN N’EST ENVOYÉ/)
  assert.match(draft.reply,/GO SMS #ABC123/)
  assert.equal(trace.filter(x=>x.table==='lumia_sms_outbox').length,0)
  const approved=await maybeHandleLumiaSmsChat({
    db,userId:id,conversationId:id,message:'GO SMS #ABC123',
    env:{LUMIA_SMS_SEND_ENABLED:'true'},now,
  })
  assert.match(approved.reply,/file d’envoi/)
  assert.equal(trace.filter(x=>x.table==='lumia_sms_outbox').length,1)
  assert.equal(trace.find(x=>x.table==='lumia_sms_outbox').value.recipient,num)
})

test('API Mac : token correct sans travail renvoie job null et ne lit pas les messages personnels', async () => {
  const token='k'.repeat(48), calls=[]
  const chain={
    select(){return chain},eq(){return chain},
    maybeSingle:async()=>({data:{owner_id:id},error:null}),
  }
  const db={
    from(table){calls.push(table);return chain},
    async rpc(name,args){calls.push(name);return {data:[],error:null}},
  }
  const result=await handleLumiaSmsOutboxApi({
    req:{method:'GET',headers:{authorization:`Bearer ${token}`}},
    env:{LUMIA_SMS_OUTBOX_ENABLED:'true',LUMIA_SMS_OUTBOX_TOKEN:token},
    db,
  })
  assert.equal(result.status,200)
  assert.deepEqual(result.body,{job:null})
  assert.deepEqual(calls,['booking_practitioners','lumia_claim_sms_outbox'])
})

test('Sécurité Mac : endpoint explicitement choisi, Preview MediumIA acceptée, autres refusés', () => {
  const preview='https://mediumia-site-gifcy1r89-seguins-projects-a1d4673f.vercel.app/api/rdv-admin?action=lumia-sms-outbox'
  assert.equal(assertApprovedOutboxEndpoint(preview).hostname,
    'mediumia-site-gifcy1r89-seguins-projects-a1d4673f.vercel.app')
  assert.throws(()=>assertApprovedOutboxEndpoint(),/outbox_endpoint_required/)
  assert.throws(()=>assertApprovedOutboxEndpoint('https://evil.vercel.app/api/rdv-admin?action=lumia-sms-outbox'),/outbox_host_not_allowed/)
  assert.throws(()=>assertApprovedOutboxEndpoint('https://mediumia.fr/api/rdv-admin?action=lumia-rdv-intake'),/outbox_path_not_allowed/)
  assert.throws(()=>assertApprovedOutboxEndpoint('https://mediumia.fr/api/rdv-admin?action=lumia-sms-outbox&other=1'),/outbox_path_not_allowed/)
})

test('Preview SSO : exige un OIDC éphémère, jamais envoyé sur Production', async () => {
  const preview='https://mediumia-site-gifcy1r89-seguins-projects-a1d4673f.vercel.app/api/rdv-admin?action=lumia-sms-outbox'
  const token='x'.repeat(64)
  let count=0
  const fetchImpl=async (_url, opts)=> {
    count++
    assert.equal(opts.headers.authorization,`Bearer ${token}`)
    assert.equal(opts.headers['x-vercel-trusted-oidc-idp-token'],'oidc-fictif-test')
    return { ok:true, json:async()=>({job:null}) }
  }
  await assert.rejects(()=>callOutbox({
    endpoint:preview,token,fetchImpl,env:{},
  }),/vercel_preview_auth_required/)
  assert.equal(count,0)
  assert.deepEqual(await callOutbox({
    endpoint:preview,token,fetchImpl,env:{VERCEL_OIDC_TOKEN:'oidc-fictif-test'},
  }),{job:null})
  assert.equal(count,1)
  let prodHeaders
  await callOutbox({
    endpoint:'https://mediumia.fr/api/rdv-admin?action=lumia-sms-outbox',token,
    env:{VERCEL_OIDC_TOKEN:'oidc-fictif-test'},
    fetchImpl:async (_url,opts)=>{
      prodHeaders=opts.headers
      return {ok:true,json:async()=>({job:null})}
    },
  })
  assert.equal(prodHeaders['x-vercel-trusted-oidc-idp-token'],undefined)
})

test('Mac : un travail réclamé n’est jamais renvoyé, même si la preuve chat.db est absente', async () => {
  const called=[]
  const job={id,recipient:num,channel:'sms',body}
  const requests=[]
  const result=await processApprovedSmsOnce({
    endpoint:'https://mediumia-site-gifcy1r89-seguins-projects-a1d4673f.vercel.app/api/rdv-admin?action=lumia-sms-outbox',
    getToken: async()=> 'x'.repeat(64),
    allowedHandles:[num],
    openDb:()=>({
      initialCursor:()=>10,
      newMessages:()=>[{ is_from_me:1,handle:num,text:body }],
      close:()=>called.push('closed'),
    }),
    send:async()=>called.push('send'),
    request:async(args)=>{requests.push(args); return args.method==='POST'?{status:'accepted'}:{job}},
  })
  assert.equal(result.status,'accepted')
  assert.deepEqual(called,['send','closed'])
  assert.equal(requests.length,2)
  assert.deepEqual(requests[1].payload,{id,status:'accepted',error_code:null})
})

test('L’API de sortie ne contient aucun endpoint public et aucune écriture Apple SQL', () => {
  const api=readFileSync(new URL('../api/rdv-admin.js',import.meta.url),'utf8')
  const chat=readFileSync(new URL('../api/agent-chat.js',import.meta.url),'utf8')
  const sql=readFileSync(new URL('../supabase/migrations/20261124193000_lumia_sms_outbox.sql',import.meta.url),'utf8')
  assert.match(api,/req.query.action === 'lumia-sms-outbox'/)
  assert.match(chat,/maybeHandleLumiaSmsChat/)
  assert.match(sql,/FOR UPDATE SKIP LOCKED/)
  assert.match(sql,/status='dispatching'/)
  assert.match(sql,/REVOKE ALL ON public.lumia_sms_outbox FROM PUBLIC, anon, authenticated/)
  assert.match(sql,/intent_id UUID NOT NULL UNIQUE/)
})
