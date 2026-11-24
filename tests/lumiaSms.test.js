import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseLumiaSmsCommand, maybeHandleLumiaSmsChat } from '../lib/lumiaSmsChat.js'
import { handleLumiaSmsOutboxApi } from '../lib/lumiaSmsOutbox.js'
import { validateApprovedSms, outgoingFound, processApprovedSmsOnce } from '../tools/lumia-messages-bridge/src/outbox.js'

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

test('Mac : un travail réclamé n’est jamais renvoyé, même si la preuve chat.db est absente', async () => {
  const called=[]
  const job={id,recipient:num,channel:'sms',body}
  const requests=[]
  const result=await processApprovedSmsOnce({
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
