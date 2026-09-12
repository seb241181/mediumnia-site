function actionRequestKey(action, payload) {
  if (action === 'prepare_upload') return `${action}:${payload.name}:${payload.sizeBytes}:${payload.mimeType}`
  if (action === 'set_approval') return `${action}:${payload.documentId}:${payload.approved}`
  if (payload.documentId) return `${action}:${payload.documentId}`
  return `${action}:${payload.name || ''}`
}

function isAmbiguousFunctionError(error, payload) {
  // A parser failure recorded by PostgreSQL closes its attempt. Other 5xx
  // responses may still be transport-ambiguous and must keep their key.
  if (payload?.extractionAttemptFinalized === true) return false
  const status = Number(error?.context?.status)
  return !Number.isFinite(status) || status >= 500
}

async function readFunctionErrorPayload(data, error) {
  if (data?.error) return data
  const response = error?.context
  if (typeof response?.clone !== 'function') return data || null
  try {
    return await response.clone().json()
  } catch {
    return data || null
  }
}

function actionError(payload, functionError) {
  const error = new Error(payload?.error || functionError?.message || 'Action documentaire indisponible.')
  if (payload && typeof payload === 'object') Object.assign(error, payload)
  return error
}

export async function invokeAgentDocumentAction({
  action,
  agentId,
  payload = {},
  pendingRequestIds,
  invoke,
  createRequestId = () => crypto.randomUUID(),
}) {
  const requestKey = `${agentId}:${actionRequestKey(action, payload)}`
  const requestId = payload.requestId || pendingRequestIds.get(requestKey) || createRequestId()
  pendingRequestIds.set(requestKey, requestId)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error: functionError } = await invoke({
      action,
      agentId,
      ...payload,
      requestId,
    })
    if (!functionError && !data?.error) {
      pendingRequestIds.delete(requestKey)
      return data || {}
    }

    const errorPayload = await readFunctionErrorPayload(data, functionError)
    const retryable = Boolean(functionError) && isAmbiguousFunctionError(functionError, errorPayload)
    if (!retryable || attempt === 1) {
      if (!retryable) pendingRequestIds.delete(requestKey)
      throw actionError(errorPayload, functionError)
    }
  }

  throw new Error('Action documentaire indisponible.')
}
