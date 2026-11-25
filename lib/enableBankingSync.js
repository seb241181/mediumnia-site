/* global process */
import { createHmac } from 'node:crypto'
import { readBankConnectionConfig, unprotectBankValue, enableBankingGet } from './enableBankingAuth.js'
import { proposeBankTransferMatches } from './rdvBankReconciliation.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_PAGES = 10
const MAX_REQUESTS = 150
const dateUtc = d => d.toISOString().slice(0, 10)

export function bankSyncEnabled(env = process.env) {
  return env.ENABLE_BANKING_SYNC_ENABLED === 'true' && readBankConnectionConfig(env) != null
}

/**
 * Read a bounded 14-day window of booked transactions. No payloads are logged
 * or persisted; return only a completely paginated set, or fail closed.
 */
export async function fetchBookCredits(config, accountUid, now = new Date(), read = enableBankingGet) {
  if (!UUID_RE.test(String(accountUid || ''))) throw new Error('invalid_bank_account')
  const from = new Date(now.getTime() - 14 * 86400000)
  const transactions = []
  const seenPages = new Set()
  let next = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await read(config, 'transactions', accountUid, {
      date_from: dateUtc(from), date_to: dateUtc(now),
      ...(next ? { continuation_key: next } : {}),
    })
    if (!Array.isArray(data?.transactions)) throw new Error('bank_response_invalid')
    if (transactions.length + data.transactions.length > 1500) throw new Error('bank_result_too_large')
    transactions.push(...data.transactions)
    next = data.continuation_key || null
    if (!next) return transactions
    if (typeof next !== 'string' || next.length > 2048 || seenPages.has(next)) throw new Error('bank_pagination_invalid')
    seenPages.add(next)
  }
  throw new Error('bank_pagination_incomplete')
}

async function loadPendingRequests(db, practitionerId) {
  const { data, error } = await db.from('rdv_bank_booking_requests')
    .select('id,transfer_reference,amount_cents,status,hold:rdv_booking_holds!inner(practitioner_id,expires_at)')
    .eq('hold.practitioner_id', practitionerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(MAX_REQUESTS + 1)
  if (error || !Array.isArray(data)) throw new Error('bank_requests_unavailable')
  if (data.length > MAX_REQUESTS) throw new Error('bank_requests_too_many')
  return data.map(item => ({
    id: item.id, reference: item.transfer_reference,
    amount_cents: item.amount_cents, status: item.status,
    expires_at: item.hold?.expires_at,
  }))
}

export async function syncBankConnection({ db, connection, config = readBankConnectionConfig(), now = new Date(), read = enableBankingGet }) {
  if (!config || connection?.status !== 'active' || !UUID_RE.test(String(connection.practitioner_id || ''))) {
    return { status: 'skipped' }
  }
  if (new Date(connection.valid_until).getTime() <= now.getTime()) return { status: 'consent_expired' }
  const sessionId = unprotectBankValue(connection.session_id_enc, config)
  const accountUid = unprotectBankValue(connection.account_uid_enc, config)
  if (!UUID_RE.test(sessionId) || !UUID_RE.test(accountUid)) throw new Error('bank_session_invalid')
  const session = await read(config, 'session', sessionId)
  if (session?.status !== 'AUTHORIZED' || session?.psu_type !== 'business'
      || session?.aspsp?.country !== 'FR' || session.aspsp.name !== config.aspsp
      || !Array.isArray(session.accounts) || !session.accounts.includes(accountUid)
      || new Date(session?.access?.valid_until || '').getTime() <= now.getTime()) {
    return { status: 'consent_invalid' }
  }

  const transactions = await fetchBookCredits(config, accountUid, now, read)
  const requests = await loadPendingRequests(db, connection.practitioner_id)
  const proposed = proposeBankTransferMatches({ transactions, requests, now })
  let created = 0
  for (const match of proposed.matches) {
    // Hash of account + stable bank entry_reference; never hash mutable transaction_id.
    // The database enforces unique transaction_hash and request_id.
    const transactionHash = createHmac('sha256', config.dataKey)
      .update(accountUid + ':' + match.bank_entry_reference).digest('hex')
    const { error } = await db.from('rdv_bank_reconciliation_candidates').upsert({
      practitioner_id: connection.practitioner_id,
      owner_id: connection.owner_id,
      request_id: match.request_id,
      transaction_hash: transactionHash,
      amount_cents: match.amount_cents,
      booked_on: match.booked_on,
      status: 'review_required',
    }, { onConflict: 'request_id', ignoreDuplicates: true })
    if (error) throw new Error('bank_candidate_write_failed')
    created++
  }
  const { error } = await db.from('rdv_bank_connections').update({
    last_synced_at: now.toISOString(), last_sync_error: null,
  }).eq('practitioner_id', connection.practitioner_id).eq('status', 'active')
  if (error) throw new Error('bank_sync_status_write_failed')
  return { status: 'ok', candidates_processed: created, items_to_review: proposed.review.length }
}

export async function runAllBankSyncs(db, now = new Date()) {
  if (!bankSyncEnabled()) return { status: 'disabled' }
  const { data: connections, error } = await db.from('rdv_bank_connections')
    .select('practitioner_id,owner_id,status,session_id_enc,account_uid_enc,valid_until')
    .eq('status', 'active').limit(5)
  if (error) return { status: 'unavailable' }
  const summary = { status: 'ok', processed: 0, failed: 0 }
  for (const connection of connections || []) {
    try {
      const result = await syncBankConnection({ db, connection, now })
      if (result.status !== 'ok') { summary.failed++; continue }
      summary.processed++
    } catch {
      summary.failed++
      // Do not record provider details; they may contain sensitive data.
    }
  }
  return summary
}
