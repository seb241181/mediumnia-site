import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin, requireAuth } from './supabaseAdmin.js'

const BUCKET = 'agent-documents'
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_TEXT_CHARS = 750_000
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json'])
const ALLOWED_EXTENSIONS = /\.(pdf|txt|md|csv|json|doc|docx)$/i
const TEXT_EXTENSIONS = /\.(txt|md|csv|json)$/i

function safeFileName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140) || 'document'
}

function cleanName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 240) : ''
}

function chunkText(text, maxLength = 5000, overlap = 400) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  const chunks = []
  let start = 0
  while (start < clean.length && chunks.length < 120) {
    let end = Math.min(clean.length, start + maxLength)
    if (end < clean.length) {
      const paragraph = clean.lastIndexOf('\n\n', end)
      const sentence = clean.lastIndexOf('. ', end)
      const candidate = Math.max(paragraph, sentence)
      if (candidate > start + Math.floor(maxLength * 0.55)) end = candidate + 1
    }
    const content = clean.slice(start, end).trim()
    if (content) chunks.push(content)
    if (end >= clean.length) break
    start = Math.max(start + 1, end - overlap)
  }
  return chunks
}

function isAllowedFile(name, mimeType) {
  return ALLOWED_EXTENSIONS.test(name) && ALLOWED_MIME_TYPES.has(mimeType)
}

function isTextFile(name, mimeType) {
  return TEXT_EXTENSIONS.test(name) && TEXT_MIME_TYPES.has(mimeType)
}

async function writeDocumentAudit(db, { ownerId, agentId, eventType, documentId, requestId, details = {} }) {
  await db.from('agent_audit_events').insert({
    owner_id: ownerId,
    agent_id: agentId,
    event_type: eventType,
    resource_type: 'document',
    resource_id: documentId ? String(documentId) : null,
    details: {
      request_id: requestId,
      result: 'success',
      ...details,
    },
  })
}

async function resolveDocumentContext(req, agentId) {
  const auth = await requireAuth(req)
  if (auth.error) return { error: auth.error, status: auth.status }
  if (!agentId) return { error: 'agent_id_required', status: 400 }

  const db = getSupabaseAdmin()
  const { data: membership } = await db
    .from('pro_memberships')
    .select('id, status, expires_at')
    .eq('user_id', auth.userId)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership || (membership.expires_at && new Date(membership.expires_at) <= new Date())) {
    return { error: 'pro_access_required', status: 403 }
  }

  const { data: agent } = await db
    .from('agents')
    .select('id, owner_id, membership_id, status')
    .eq('id', agentId)
    .eq('owner_id', auth.userId)
    .eq('membership_id', membership.id)
    .maybeSingle()

  if (!agent || !['active', 'draft'].includes(agent.status)) {
    return { error: 'copilot_not_found', status: 404 }
  }

  return { db, ownerId: auth.userId, membership, agent }
}

async function getOwnedDocument(db, ownerId, agentId, documentId) {
  if (!documentId) return null
  const { data } = await db
    .from('agent_documents')
    .select('id, agent_id, owner_id, name, source_type, storage_bucket, storage_path, mime_type, size_bytes, status, approved_for_ai, metadata')
    .eq('id', documentId)
    .eq('agent_id', agentId)
    .eq('owner_id', ownerId)
    .maybeSingle()
  return data || null
}

async function indexDocumentText(db, { document, ownerId, agentId, text }) {
  if (typeof text !== 'string' || text.length > MAX_TEXT_CHARS) throw new Error('text_too_large')
  const chunks = chunkText(text)
  if (!chunks.length) throw new Error('empty_document_text')

  await db.from('agent_document_chunks').delete().eq('document_id', document.id).eq('agent_id', agentId).eq('owner_id', ownerId)
  const { error: chunkError } = await db.from('agent_document_chunks').insert(
    chunks.map((content, chunkIndex) => ({
      document_id: document.id,
      agent_id: agentId,
      owner_id: ownerId,
      chunk_index: chunkIndex,
      content,
    })),
  )
  if (chunkError) throw new Error('chunk_persistence_failed')

  const metadata = {
    ...(document.metadata || {}),
    chunks: chunks.length,
    indexed_server: true,
  }
  const { error: updateError } = await db
    .from('agent_documents')
    .update({ status: 'ready', error_message: null, metadata })
    .eq('id', document.id)
    .eq('agent_id', agentId)
    .eq('owner_id', ownerId)
  if (updateError) throw new Error('document_update_failed')
  return chunks.length
}

export async function handleAgentDocumentAction({ req, res, requestId, startedAt, action, technicalLog }) {
  const { agentId } = req.body || {}
  const context = await resolveDocumentContext(req, agentId)
  if (context.error) {
    technicalLog(requestId, action, 'rejected', startedAt, context.error)
    return res.status(context.status).json({ error: context.error, requestId })
  }

  const { db, ownerId, agent } = context

  if (action === 'document_create_text') {
    const name = cleanName(req.body?.name)
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
    if (!name || !content || content.length > MAX_TEXT_CHARS) {
      technicalLog(requestId, action, 'rejected', startedAt, 'invalid_document_text')
      return res.status(400).json({ error: 'invalid_document_text', requestId })
    }

    const { data: document, error: createError } = await db
      .from('agent_documents')
      .insert({
        agent_id: agent.id,
        owner_id: ownerId,
        name,
        source_type: 'paste',
        status: 'processing',
        approved_for_ai: false,
        sensitivity: 'confidential',
        metadata: { created_via: 'server' },
      })
      .select('id, name, status, approved_for_ai, metadata')
      .single()

    if (createError || !document) {
      technicalLog(requestId, action, 'failed', startedAt, 'document_create_failed')
      return res.status(500).json({ error: 'document_create_failed', requestId })
    }

    try {
      const chunks = await indexDocumentText(db, { document, ownerId, agentId: agent.id, text: content })
      await writeDocumentAudit(db, {
        ownerId,
        agentId: agent.id,
        eventType: 'document_created_from_text',
        documentId: document.id,
        requestId,
        details: { name, chunks },
      })
      technicalLog(requestId, action, 'success', startedAt)
      return res.status(200).json({ documentId: document.id, status: 'ready', chunks, requestId })
    } catch (error) {
      await db.from('agent_documents').update({ status: 'error', error_message: error.message || 'index_failed' }).eq('id', document.id)
      technicalLog(requestId, action, 'failed', startedAt, error.message || 'index_failed')
      return res.status(500).json({ error: 'document_index_failed', documentId: document.id, requestId })
    }
  }

  if (action === 'document_prepare_upload') {
    const name = cleanName(req.body?.name)
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim().toLowerCase() : ''
    const sizeBytes = Number(req.body?.sizeBytes)
    if (!name || !Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES || !isAllowedFile(name, mimeType)) {
      technicalLog(requestId, action, 'rejected', startedAt, 'invalid_upload')
      return res.status(400).json({ error: 'invalid_upload', requestId })
    }

    const storagePath = `${ownerId}/${agent.id}/${randomUUID()}-${safeFileName(name)}`
    const { data: signed, error: signedError } = await db.storage.from(BUCKET).createSignedUploadUrl(storagePath, { upsert: false })
    if (signedError || !signed?.token) {
      technicalLog(requestId, action, 'failed', startedAt, 'signed_upload_failed')
      return res.status(500).json({ error: 'signed_upload_failed', requestId })
    }

    const { data: document, error: createError } = await db
      .from('agent_documents')
      .insert({
        agent_id: agent.id,
        owner_id: ownerId,
        name,
        source_type: 'upload',
        storage_bucket: BUCKET,
        storage_path: storagePath,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        status: 'processing',
        approved_for_ai: false,
        sensitivity: 'confidential',
        metadata: { upload_pending: true, created_via: 'server' },
      })
      .select('id')
      .single()

    if (createError || !document) {
      technicalLog(requestId, action, 'failed', startedAt, 'document_create_failed')
      return res.status(500).json({ error: 'document_create_failed', requestId })
    }

    technicalLog(requestId, action, 'success', startedAt)
    return res.status(200).json({
      documentId: document.id,
      bucket: BUCKET,
      path: storagePath,
      token: signed.token,
      requestId,
    })
  }

  if (action === 'document_finalize_upload') {
    const document = await getOwnedDocument(db, ownerId, agent.id, req.body?.documentId)
    if (!document || document.source_type !== 'upload' || document.status !== 'processing' || !document.storage_path) {
      technicalLog(requestId, action, 'rejected', startedAt, 'document_not_pending')
      return res.status(404).json({ error: 'document_not_pending', requestId })
    }

    const slash = document.storage_path.lastIndexOf('/')
    const folder = document.storage_path.slice(0, slash)
    const fileName = document.storage_path.slice(slash + 1)
    const { data: objects, error: listError } = await db.storage.from(BUCKET).list(folder, { search: fileName, limit: 10 })
    const stored = !listError ? (objects || []).find((item) => item.name === fileName) : null
    if (!stored) {
      technicalLog(requestId, action, 'rejected', startedAt, 'upload_missing')
      return res.status(409).json({ error: 'upload_missing', documentId: document.id, requestId })
    }

    const storedSize = Number(stored.metadata?.size)
    if (Number.isFinite(storedSize) && document.size_bytes && storedSize !== Number(document.size_bytes)) {
      await db.storage.from(BUCKET).remove([document.storage_path])
      await db.from('agent_documents').update({ status: 'error', error_message: 'upload_size_mismatch' }).eq('id', document.id)
      technicalLog(requestId, action, 'failed', startedAt, 'upload_size_mismatch')
      return res.status(409).json({ error: 'upload_size_mismatch', documentId: document.id, requestId })
    }

    const suppliedText = typeof req.body?.content === 'string' ? req.body.content : null
    let chunks = 0
    let indexed = false
    try {
      if (suppliedText !== null) {
        if (!isTextFile(document.name, document.mime_type || '')) throw new Error('text_not_allowed_for_file_type')
        chunks = await indexDocumentText(db, { document, ownerId, agentId: agent.id, text: suppliedText })
        indexed = true
      } else {
        const metadata = { ...(document.metadata || {}), upload_pending: false, uploaded: true, indexed_server: false }
        const { error: updateError } = await db
          .from('agent_documents')
          .update({ status: 'uploaded', error_message: null, metadata })
          .eq('id', document.id)
          .eq('agent_id', agent.id)
          .eq('owner_id', ownerId)
        if (updateError) throw new Error('document_update_failed')
      }

      await writeDocumentAudit(db, {
        ownerId,
        agentId: agent.id,
        eventType: 'document_uploaded',
        documentId: document.id,
        requestId,
        details: { name: document.name, mime_type: document.mime_type, size_bytes: document.size_bytes, indexed, chunks },
      })
      technicalLog(requestId, action, 'success', startedAt)
      return res.status(200).json({ documentId: document.id, status: indexed ? 'ready' : 'uploaded', indexed, chunks, requestId })
    } catch (error) {
      await db.from('agent_documents').update({ status: 'error', error_message: error.message || 'finalize_failed' }).eq('id', document.id)
      technicalLog(requestId, action, 'failed', startedAt, error.message || 'finalize_failed')
      return res.status(500).json({ error: 'document_finalize_failed', documentId: document.id, requestId })
    }
  }

  if (action === 'document_set_approval') {
    const document = await getOwnedDocument(db, ownerId, agent.id, req.body?.documentId)
    const approved = req.body?.approved
    if (!document || document.status !== 'ready' || typeof approved !== 'boolean') {
      technicalLog(requestId, action, 'rejected', startedAt, 'document_not_ready')
      return res.status(400).json({ error: 'document_not_ready', requestId })
    }

    const { error } = await db
      .from('agent_documents')
      .update({ approved_for_ai: approved, approved_at: approved ? new Date().toISOString() : null })
      .eq('id', document.id)
      .eq('agent_id', agent.id)
      .eq('owner_id', ownerId)
    if (error) {
      technicalLog(requestId, action, 'failed', startedAt, 'approval_update_failed')
      return res.status(500).json({ error: 'approval_update_failed', requestId })
    }

    await writeDocumentAudit(db, {
      ownerId,
      agentId: agent.id,
      eventType: approved ? 'document_approved_for_ai' : 'document_revoked_from_ai',
      documentId: document.id,
      requestId,
      details: { name: document.name },
    })
    technicalLog(requestId, action, 'success', startedAt)
    return res.status(200).json({ documentId: document.id, approved_for_ai: approved, requestId })
  }

  if (action === 'document_delete') {
    const document = await getOwnedDocument(db, ownerId, agent.id, req.body?.documentId)
    if (!document) {
      technicalLog(requestId, action, 'rejected', startedAt, 'document_not_found')
      return res.status(404).json({ error: 'document_not_found', requestId })
    }

    if (document.storage_path) {
      const { error: storageError } = await db.storage.from(document.storage_bucket || BUCKET).remove([document.storage_path])
      if (storageError) {
        technicalLog(requestId, action, 'failed', startedAt, 'storage_delete_failed')
        return res.status(500).json({ error: 'storage_delete_failed', requestId })
      }
    }

    const { error: deleteError } = await db
      .from('agent_documents')
      .delete()
      .eq('id', document.id)
      .eq('agent_id', agent.id)
      .eq('owner_id', ownerId)
    if (deleteError) {
      technicalLog(requestId, action, 'failed', startedAt, 'document_delete_failed')
      return res.status(500).json({ error: 'document_delete_failed', requestId })
    }

    await writeDocumentAudit(db, {
      ownerId,
      agentId: agent.id,
      eventType: 'document_deleted',
      documentId: document.id,
      requestId,
      details: { name: document.name },
    })
    technicalLog(requestId, action, 'success', startedAt)
    return res.status(200).json({ deleted: true, documentId: document.id, requestId })
  }

  technicalLog(requestId, action, 'rejected', startedAt, 'unsupported_document_action')
  return res.status(400).json({ error: 'unsupported_document_action', requestId })
}
