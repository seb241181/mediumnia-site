/**
 * Reconciles MediumIA bank-transfer requests with booked incoming bank operations.
 * Read-only: results are proposed for owner review; this module never confirms a
 * booking, sends an email, creates a financial entry, or writes to a database.
 * Only server-fetched Open Banking transactions may be supplied by the caller.
 */
const TRANSFER_REF_RE = /\bMDIA-[A-F0-9]{12}\b/g
const VALID_REF_RE = /^MDIA-[A-F0-9]{12}$/

function euroCents(amount) {
  if (typeof amount !== 'string' && typeof amount !== 'number') return null
  const raw = String(amount).trim()
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(raw)) return null
  const [whole, decimals = ''] = raw.split('.')
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

function transactionReferences(tx) {
  const text = [
    ...(Array.isArray(tx.remittance_information) ? tx.remittance_information : []),
    tx.reference_number,
    tx.note,
  ].filter(value => typeof value === 'string').join(' ').toUpperCase()
  return [...new Set(text.match(TRANSFER_REF_RE) || [])]
}

function eligibleCredit(tx) {
  return tx?.status === 'BOOK'
    && tx.credit_debit_indicator === 'CRDT'
    && tx.transaction_amount?.currency === 'EUR'
    && euroCents(tx.transaction_amount.amount) !== null
}

/**
 * @param {{transactions: object[], requests: object[], now?: Date}} input
 * @returns {{matches: object[], review: object[]}} matches are NOT payment confirmations.
 */
export function proposeBankTransferMatches({ transactions = [], requests = [], now = new Date() } = {}) {
  const matches = []
  const review = []
  const byReference = new Map()
  for (const tx of transactions) {
    if (!eligibleCredit(tx)) continue
    const references = transactionReferences(tx)
    for (const reference of references) {
      const candidates = byReference.get(reference) || []
      candidates.push({
        // entry_reference is the bank's stable reference across sessions;
        // transaction_id is not stable and must never be used for deduplication.
        bankEntryReference: typeof tx.entry_reference === 'string' ? tx.entry_reference.trim() : '',
        amountCents: euroCents(tx.transaction_amount.amount),
        referenceCount: references.length,
        date: tx.booking_date || tx.transaction_date || null,
      })
      byReference.set(reference, candidates)
    }
  }
  for (const request of requests) {
    const ref = String(request.reference || request.transfer_reference || '').toUpperCase()
    if (request.status !== 'pending' || !VALID_REF_RE.test(ref)) continue
    const candidates = byReference.get(ref) || []
    if (!candidates.length) continue
    const expectedAmount = Number(request.amount_cents)
    const expired = Boolean(request.expires_at) && new Date(request.expires_at).getTime() <= now.getTime()
    const exact = candidates.filter(tx => tx.amountCents === expectedAmount && tx.referenceCount === 1 && tx.bankEntryReference)
    const uniqueIds = new Set(exact.map(tx => tx.bankEntryReference))
    if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0 || expired || candidates.length !== 1 || exact.length !== 1 || uniqueIds.size !== 1) {
      review.push({ request_id: request.id, reference: ref, reason: expired ? 'request_expired' : 'ambiguous_or_amount_mismatch' })
      continue
    }
    matches.push({
      request_id: request.id,
      reference: ref,
      amount_cents: expectedAmount,
      bank_entry_reference: exact[0].bankEntryReference,
      booked_on: exact[0].date,
      status: 'review_required',
    })
  }
  return { matches, review }
}
