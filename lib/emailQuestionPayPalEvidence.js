// PayPal evidence classifier — pure, fail-closed, no network calls or mutations.
// Never promote a database order to "paid" based on this preview alone.
const REVIEW = (reason, extra = {}) => ({ classification: 'manual_review', reason, ...extra })

export function summarizeGuidancePayPalEvidence(row, order, captureDetails = null) {
  const orderId = String(row?.paypal_order_id || '')
  if (!order || order.id !== orderId) return REVIEW('order_id_mismatch')
  const units = Array.isArray(order.purchase_units) ? order.purchase_units : []
  const matches = units.filter((unit) => unit.custom_id === row?.id)
  if (matches.length !== 1 || units.length !== 1) return REVIEW('custom_id_or_purchase_units_mismatch', {
    orderStatus: order.status || 'unknown',
  })
  const unit = matches[0]
  if (unit.reference_id !== `MEDIUMIA_EMAIL_${String(row.pack || '').toUpperCase()}`) {
    return REVIEW('reference_mismatch', { orderStatus: order.status || 'unknown' })
  }
  const captures = Array.isArray(unit.payments?.captures) ? unit.payments.captures : []
  if (captures.length === 0) return REVIEW('no_capture_found', { orderStatus: order.status || 'unknown' })
  // Any multiple captures (including pending/refunded) require manual investigation.
  if (captures.length !== 1) return REVIEW('multiple_captures', {
    orderStatus: order.status || 'unknown', captureCount: captures.length,
  })

  const capture = captures[0]
  const captureId = capture?.id
  const requiredAmount = (Number(row.amount_cents) / 100).toFixed(2)
  const expectedCurrency = String(row.currency || 'EUR')
  if (!captureId || !/^[A-Za-z0-9-]{8,128}$/.test(captureId)) {
    return REVIEW('invalid_capture_id', { orderStatus: order.status || 'unknown' })
  }

  const basic = {
    orderStatus: order.status || 'unknown',
    captureId,
    captureStatus: capture.status || 'unknown',
  }
  if (captureDetails && captureDetails.id !== captureId) return REVIEW('capture_id_mismatch', basic)
  if (!captureDetails) return REVIEW('capture_detail_not_checked', basic)

  const detailStatus = captureDetails.status || 'unknown'
  const expectedAmount = capture.amount?.value === requiredAmount
    && capture.amount?.currency_code === expectedCurrency
    && captureDetails.amount?.value === requiredAmount
    && captureDetails.amount?.currency_code === expectedCurrency

  if (!expectedAmount || expectedCurrency !== 'EUR') {
    return REVIEW('amount_or_currency_mismatch', { ...basic, detailStatus })
  }
  if (detailStatus === 'REFUNDED' || detailStatus === 'PARTIALLY_REFUNDED') {
    return REVIEW('refund_detected', { ...basic, detailStatus })
  }
  if (order.status !== 'COMPLETED' || capture.status !== 'COMPLETED' || detailStatus !== 'COMPLETED') {
    return REVIEW('capture_not_fully_completed', { ...basic, detailStatus })
  }

  return {
    classification: 'capture_confirmed_readonly',
    reason: 'capture_consistent',
    ...basic,
    detailStatus,
  }
}
