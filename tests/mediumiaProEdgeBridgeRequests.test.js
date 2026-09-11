import assert from 'node:assert/strict'
import test from 'node:test'
import { invokeAgentDocumentAction } from '../src/lib/agentDocumentRequests.js'

test('document retries reuse one idempotency key after an ambiguous server failure', async () => {
  const pendingRequestIds = new Map()
  const bodies = []
  let calls = 0
  const invoke = async (body) => {
    bodies.push(body)
    calls += 1
    if (calls <= 2) {
      const response = new Response(JSON.stringify({
        error: 'signed_upload_failed',
        retryable: true,
      }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      return {
        data: null,
        error: { message: 'relay timeout', context: response },
      }
    }
    return { data: { documentId: 'document-1' }, error: null }
  }

  const options = {
    action: 'prepare_upload',
    agentId: 'agent-1',
    payload: { name: 'guide.pdf', mimeType: 'application/pdf', sizeBytes: 123 },
    pendingRequestIds,
    invoke,
    createRequestId: () => '50000000-0000-4000-8000-000000000001',
  }

  await assert.rejects(invokeAgentDocumentAction(options), /signed_upload_failed/)
  const result = await invokeAgentDocumentAction(options)

  assert.equal(result.documentId, 'document-1')
  assert.equal(new Set(bodies.map((body) => body.requestId)).size, 1)
  assert.equal(pendingRequestIds.size, 0)
})

test('a definitive request error rotates the key for the next logical operation', async () => {
  const pendingRequestIds = new Map()
  const bodies = []
  const ids = [
    '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
  ]
  const createRequestId = () => ids.shift()

  await assert.rejects(
    invokeAgentDocumentAction({
      action: 'set_approval',
      agentId: 'agent-1',
      payload: { documentId: 'document-1', approved: true },
      pendingRequestIds,
      createRequestId,
      invoke: async (body) => {
        bodies.push(body)
        return { data: { error: 'document_not_ready' }, error: null }
      },
    }),
    /document_not_ready/,
  )

  await invokeAgentDocumentAction({
    action: 'set_approval',
    agentId: 'agent-1',
    payload: { documentId: 'document-1', approved: true },
    pendingRequestIds,
    createRequestId,
    invoke: async (body) => {
      bodies.push(body)
      return { data: { approved_for_ai: true }, error: null }
    },
  })

  assert.notEqual(bodies[0].requestId, bodies[1].requestId)
  assert.equal(pendingRequestIds.size, 0)
})

test('a committed extraction timeout waits for a manual retry with a fresh operation id', async () => {
  const pendingRequestIds = new Map()
  const bodies = []
  const ids = [
    '50000000-0000-4000-8000-000000000011',
    '50000000-0000-4000-8000-000000000012',
  ]
  let timeoutCalls = 0

  const options = {
    action: 'retry_extract',
    agentId: 'agent-1',
    payload: { documentId: 'document-1' },
    pendingRequestIds,
    createRequestId: () => ids.shift(),
  }

  await assert.rejects(
    invokeAgentDocumentAction({
      ...options,
      invoke: async (body) => {
        bodies.push(body)
        timeoutCalls += 1
        const response = new Response(JSON.stringify({
          error: 'pdf_extraction_timeout',
          stored: true,
          extractionAttemptFinalized: true,
        }), {
          status: 504,
          headers: { 'Content-Type': 'application/json' },
        })
        return {
          data: null,
          error: { message: 'Edge Function timed out extraction', context: response },
        }
      },
    }),
    /pdf_extraction_timeout/,
  )

  assert.equal(timeoutCalls, 1, 'a committed timeout must not auto-replay the closed attempt')
  assert.equal(pendingRequestIds.size, 0)

  await invokeAgentDocumentAction({
    ...options,
    invoke: async (body) => {
      bodies.push(body)
      return { data: { indexed: true }, error: null }
    },
  })

  assert.notEqual(bodies[0].requestId, bodies[1].requestId)
})

test('an HTTP error body remains available to the upload recovery path', async () => {
  const response = new Response(JSON.stringify({
    error: 'invalid_pdf_signature',
    documentId: 'document-1',
    stored: true,
  }), { status: 422, headers: { 'Content-Type': 'application/json' } })

  await assert.rejects(
    invokeAgentDocumentAction({
      action: 'finalize_upload',
      agentId: 'agent-1',
      payload: { documentId: 'document-1' },
      pendingRequestIds: new Map(),
      createRequestId: () => '50000000-0000-4000-8000-000000000001',
      invoke: async () => ({
        data: null,
        error: { message: 'Edge Function returned a non-2xx status', context: response },
      }),
    }),
    (error) => error.message === 'invalid_pdf_signature' && error.stored === true,
  )
})
