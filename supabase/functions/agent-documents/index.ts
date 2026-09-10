import { createClient } from 'npm:@supabase/supabase-js@2'

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
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function safeFileName(name: string) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140) || 'document'
}

function cleanName(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 240) : ''
}

function chunkText(text: string, maxLength = 5000, overlap = 400) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  const chunks: string[] = []
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

function isAllowedFile(name: string, mimeType: string) {
  return ALLOWED_EXTENSIONS.test(name) && ALLOWED_MIME_TYPES.has(mimeType)
}

function isTextFile(name: string, mimeType: string) {
  return TEXT_EXTENSIONS.test(name) && TEXT_MIME_TYPES.has(mimeType)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) return response({ error: 'server_configuration' }, 503)

  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) return response({ error: 'unauthenticated' }, 401)

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  })
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) return response({ error: 'unauthenticated' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return response({ error: 'invalid_json' }, 400)
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const agentId = typeof body.agentId === 'string' ? body.agentId : ''
  if (!action || !agentId) return response({ error: 'invalid_request' }, 400)

  const { data: membership } = await admin
    .from('pro_memberships')
    .select('id, expires_at')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership || (membership.expires_at && new Date(membership.expires_at) <= new Date())) {
    return response({ error: 'pro_access_required' }, 403)
  }

  const { data: agent } = await admin
    .from('agents')
    .select('id, owner_id, membership_id, status')
    .eq('id', agentId)
    .eq('owner_id', user.id)
    .eq('membership_id', membership.id)
    .maybeSingle()
  if (!agent || !['active', 'draft'].includes(agent.status)) return response({ error: 'copilot_not_found' }, 404)

  const audit = async (eventType: string, documentId: string, details: Record<string, unknown> = {}) => {
    await admin.from('agent_audit_events').insert({
      owner_id: user.id,
      agent_id: agent.id,
      event_type: eventType,
      resource_type: 'document',
      resource_id: documentId,
      details: { result: 'success', ...details },
    })
  }

  const getDocument = async (documentId: unknown) => {
    if (typeof documentId !== 'string' || !documentId) return null
    const { data } = await admin
      .from('agent_documents')
      .select('id, agent_id, owner_id, name, source_type, storage_bucket, storage_path, mime_type, size_bytes, status, approved_for_ai, metadata')
      .eq('id', documentId)
      .eq('agent_id', agent.id)
      .eq('owner_id', user.id)
      .maybeSingle()
    return data || null
  }

  const indexText = async (document: Record<string, any>, text: string) => {
    if (text.length > MAX_TEXT_CHARS) throw new Error('text_too_large')
    const chunks = chunkText(text)
    if (!chunks.length) throw new Error('empty_document_text')

    await admin.from('agent_document_chunks').delete().eq('document_id', document.id).eq('agent_id', agent.id).eq('owner_id', user.id)
    const { error: chunkError } = await admin.from('agent_document_chunks').insert(
      chunks.map((content, chunkIndex) => ({
        document_id: document.id,
        agent_id: agent.id,
        owner_id: user.id,
        chunk_index: chunkIndex,
        content,
      })),
    )
    if (chunkError) throw new Error('chunk_persistence_failed')

    const { error: updateError } = await admin
      .from('agent_documents')
      .update({
        status: 'ready',
        error_message: null,
        metadata: { ...(document.metadata || {}), upload_pending: false, chunks: chunks.length, indexed_server: true },
      })
      .eq('id', document.id)
      .eq('agent_id', agent.id)
      .eq('owner_id', user.id)
    if (updateError) throw new Error('document_update_failed')
    return chunks.length
  }

  if (action === 'create_text') {
    const name = cleanName(body.name)
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!name || !content || content.length > MAX_TEXT_CHARS) return response({ error: 'invalid_document_text' }, 400)

    const { data: document, error: createError } = await admin
      .from('agent_documents')
      .insert({
        agent_id: agent.id,
        owner_id: user.id,
        name,
        source_type: 'paste',
        status: 'processing',
        approved_for_ai: false,
        sensitivity: 'confidential',
        metadata: { created_via: 'server' },
      })
      .select('id, metadata')
      .single()
    if (createError || !document) return response({ error: 'document_create_failed' }, 500)

    try {
      const chunks = await indexText(document, content)
      await audit('document_created_from_text', document.id, { name, chunks })
      return response({ documentId: document.id, status: 'ready', chunks })
    } catch (error) {
      const code = error instanceof Error ? error.message : 'index_failed'
      await admin.from('agent_documents').update({ status: 'error', error_message: code }).eq('id', document.id)
      return response({ error: 'document_index_failed', documentId: document.id }, 500)
    }
  }

  if (action === 'prepare_upload') {
    const name = cleanName(body.name)
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : ''
    const sizeBytes = Number(body.sizeBytes)
    if (!name || !Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES || !isAllowedFile(name, mimeType)) {
      return response({ error: 'invalid_upload' }, 400)
    }

    const storagePath = `${user.id}/${agent.id}/${crypto.randomUUID()}-${safeFileName(name)}`
    const { data: signed, error: signedError } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath, { upsert: false })
    if (signedError || !signed?.token) return response({ error: 'signed_upload_failed' }, 500)

    const { data: document, error: createError } = await admin
      .from('agent_documents')
      .insert({
        agent_id: agent.id,
        owner_id: user.id,
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
    if (createError || !document) return response({ error: 'document_create_failed' }, 500)

    return response({ documentId: document.id, bucket: BUCKET, path: storagePath, token: signed.token })
  }

  if (action === 'finalize_upload') {
    const document = await getDocument(body.documentId)
    if (!document || document.source_type !== 'upload' || document.status !== 'processing' || !document.storage_path) {
      return response({ error: 'document_not_pending' }, 404)
    }

    const slash = document.storage_path.lastIndexOf('/')
    const folder = document.storage_path.slice(0, slash)
    const fileName = document.storage_path.slice(slash + 1)
    const { data: objects, error: listError } = await admin.storage.from(BUCKET).list(folder, { search: fileName, limit: 10 })
    const stored = listError ? null : (objects || []).find((item) => item.name === fileName)
    if (!stored) return response({ error: 'upload_missing', documentId: document.id }, 409)

    const storedSize = Number(stored.metadata?.size)
    if (Number.isFinite(storedSize) && document.size_bytes && storedSize !== Number(document.size_bytes)) {
      await admin.storage.from(BUCKET).remove([document.storage_path])
      await admin.from('agent_documents').update({ status: 'error', error_message: 'upload_size_mismatch' }).eq('id', document.id)
      return response({ error: 'upload_size_mismatch', documentId: document.id }, 409)
    }

    const content = typeof body.content === 'string' ? body.content : null
    try {
      let chunks = 0
      let indexed = false
      if (content !== null) {
        if (!isTextFile(document.name, document.mime_type || '')) return response({ error: 'text_not_allowed_for_file_type' }, 400)
        chunks = await indexText(document, content)
        indexed = true
      } else {
        const { error: updateError } = await admin
          .from('agent_documents')
          .update({
            status: 'uploaded',
            error_message: null,
            metadata: { ...(document.metadata || {}), upload_pending: false, uploaded: true, indexed_server: false },
          })
          .eq('id', document.id)
          .eq('agent_id', agent.id)
          .eq('owner_id', user.id)
        if (updateError) throw new Error('document_update_failed')
      }

      await audit('document_uploaded', document.id, {
        name: document.name,
        mime_type: document.mime_type,
        size_bytes: document.size_bytes,
        indexed,
        chunks,
      })
      return response({ documentId: document.id, status: indexed ? 'ready' : 'uploaded', indexed, chunks })
    } catch (error) {
      const code = error instanceof Error ? error.message : 'finalize_failed'
      await admin.from('agent_documents').update({ status: 'error', error_message: code }).eq('id', document.id)
      return response({ error: 'document_finalize_failed', documentId: document.id }, 500)
    }
  }

  if (action === 'set_approval') {
    const document = await getDocument(body.documentId)
    const approved = body.approved
    if (!document || document.status !== 'ready' || typeof approved !== 'boolean') return response({ error: 'document_not_ready' }, 400)

    const { error } = await admin
      .from('agent_documents')
      .update({ approved_for_ai: approved, approved_at: approved ? new Date().toISOString() : null })
      .eq('id', document.id)
      .eq('agent_id', agent.id)
      .eq('owner_id', user.id)
    if (error) return response({ error: 'approval_update_failed' }, 500)

    await audit(approved ? 'document_approved_for_ai' : 'document_revoked_from_ai', document.id, { name: document.name })
    return response({ documentId: document.id, approved_for_ai: approved })
  }

  if (action === 'delete') {
    const document = await getDocument(body.documentId)
    if (!document) return response({ error: 'document_not_found' }, 404)

    if (document.storage_path) {
      const { error: storageError } = await admin.storage.from(document.storage_bucket || BUCKET).remove([document.storage_path])
      if (storageError) return response({ error: 'storage_delete_failed' }, 500)
    }

    const { error: deleteError } = await admin
      .from('agent_documents')
      .delete()
      .eq('id', document.id)
      .eq('agent_id', agent.id)
      .eq('owner_id', user.id)
    if (deleteError) return response({ error: 'document_delete_failed' }, 500)

    await audit('document_deleted', document.id, { name: document.name })
    return response({ deleted: true, documentId: document.id })
  }

  return response({ error: 'unsupported_action' }, 400)
})
