import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { unzipSync } from 'npm:fflate@0.8.3'
import { extractText, getDocumentProxy } from 'npm:unpdf@1.8.1'

const BUCKET = 'agent-documents'
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_TEXT_CHARS = 750_000
const MAX_PDF_PAGES = 400
const MAX_DOCX_XML_BYTES = 10 * 1024 * 1024
const EXTRACTION_TIMEOUT_MS = 20_000
const MIN_EXTRACTED_TEXT_CHARS = 12
const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json'])
const GENERIC_MIME_TYPES = new Set(['application/octet-stream', 'application/zip', ''])
const ALLOWED_EXTENSIONS = /\.(pdf|txt|md|csv|json|docx)$/i
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

function normalizeExtractedText(value: string) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function chunkText(text: string, maxLength = 5000, overlap = 400) {
  const clean = normalizeExtractedText(text)
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

function expectedMimeType(name: string) {
  if (/\.pdf$/i.test(name)) return PDF_MIME
  if (/\.docx$/i.test(name)) return DOCX_MIME
  if (/\.md$/i.test(name)) return 'text/markdown'
  if (/\.csv$/i.test(name)) return 'text/csv'
  if (/\.json$/i.test(name)) return 'application/json'
  if (/\.txt$/i.test(name)) return 'text/plain'
  return ''
}

function isAllowedFile(name: string, mimeType: string) {
  if (!ALLOWED_EXTENSIONS.test(name)) return false
  const mime = String(mimeType || '').trim().toLowerCase()
  const expected = expectedMimeType(name)
  if (mime === expected || GENERIC_MIME_TYPES.has(mime)) return true
  if (TEXT_EXTENSIONS.test(name) && (TEXT_MIME_TYPES.has(mime) || mime === 'application/vnd.ms-excel')) return true
  return false
}

function looksLikePdf(bytes: Uint8Array) {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d
}

function looksLikeZip(bytes: Uint8Array) {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08))
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function docxXmlToText(xml: string) {
  const withoutMarkup = xml
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:tc>/gi, '\t')
    .replace(/<\/w:tr>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
  return normalizeExtractedText(decodeXmlEntities(withoutMarkup))
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, code: string): Promise<T> {
  let timer: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), milliseconds)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function extractPdfText(bytes: Uint8Array) {
  if (!looksLikePdf(bytes)) throw new Error('invalid_pdf_signature')
  const pdf = await getDocumentProxy(bytes)
  try {
    const totalPages = Number(pdf.numPages || 0)
    if (!Number.isInteger(totalPages) || totalPages <= 0) throw new Error('invalid_pdf')
    if (totalPages > MAX_PDF_PAGES) throw new Error('pdf_page_limit')

    const extracted = await withTimeout(
      extractText(pdf, { mergePages: true }),
      EXTRACTION_TIMEOUT_MS,
      'pdf_extraction_timeout',
    )
    const rawText = Array.isArray(extracted.text) ? extracted.text.join('\n\n') : extracted.text
    const text = normalizeExtractedText(rawText)
    if (text.length < MIN_EXTRACTED_TEXT_CHARS) throw new Error('pdf_no_extractable_text')
    return {
      text,
      metadata: {
        extraction_parser: 'unpdf@1.8.1',
        extraction_pages: totalPages,
        extracted_chars: text.length,
      },
    }
  } finally {
    try { await pdf.destroy?.() } catch { /* best-effort cleanup */ }
  }
}

function extractDocxText(bytes: Uint8Array) {
  if (!looksLikeZip(bytes)) throw new Error('invalid_docx_signature')
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter(file) {
        return file.name === 'word/document.xml' && file.originalSize <= MAX_DOCX_XML_BYTES
      },
    })
  } catch {
    throw new Error('invalid_docx')
  }
  const documentXml = files['word/document.xml']
  if (!documentXml) throw new Error('docx_document_xml_missing')
  const text = docxXmlToText(new TextDecoder().decode(documentXml))
  if (text.length < MIN_EXTRACTED_TEXT_CHARS) throw new Error('docx_no_extractable_text')
  return {
    text,
    metadata: {
      extraction_parser: 'fflate-docx@0.8.3',
      extracted_chars: text.length,
    },
  }
}

function extractPlainText(bytes: Uint8Array) {
  const text = normalizeExtractedText(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ''))
  if (!text) throw new Error('empty_document_text')
  return {
    text,
    metadata: {
      extraction_parser: 'text-decoder',
      extracted_chars: text.length,
    },
  }
}

async function extractUploadedFile(admin: any, document: Record<string, any>) {
  if (!document.storage_path) throw new Error('storage_path_missing')
  const { data: blob, error } = await admin.storage
    .from(document.storage_bucket || BUCKET)
    .download(document.storage_path, {}, { cache: 'no-store' })
  if (error || !blob) throw new Error('storage_download_failed')
  if (blob.size > MAX_FILE_BYTES) throw new Error('stored_file_too_large')

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const name = String(document.name || '')
  if (/\.pdf$/i.test(name)) return await extractPdfText(bytes)
  if (/\.docx$/i.test(name)) return extractDocxText(bytes)
  if (TEXT_EXTENSIONS.test(name)) return extractPlainText(bytes)
  throw new Error('unsupported_document_type')
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

  const auditFailure = async (documentId: string, code: string) => {
    await admin.from('agent_audit_events').insert({
      owner_id: user.id,
      agent_id: agent.id,
      event_type: 'document_extraction_failed',
      resource_type: 'document',
      resource_id: documentId,
      details: { result: 'error', code },
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

  const indexText = async (document: Record<string, any>, text: string, metadata: Record<string, unknown> = {}) => {
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
        metadata: {
          ...(document.metadata || {}),
          ...metadata,
          upload_pending: false,
          uploaded: document.source_type === 'upload' ? true : undefined,
          chunks: chunks.length,
          indexed_server: true,
          extracted_at: new Date().toISOString(),
        },
      })
      .eq('id', document.id)
      .eq('agent_id', agent.id)
      .eq('owner_id', user.id)
    if (updateError) throw new Error('document_update_failed')
    return chunks.length
  }

  const processUploadedDocument = async (document: Record<string, any>, eventType: string) => {
    try {
      const extracted = await extractUploadedFile(admin, document)
      const chunks = await indexText(document, extracted.text, extracted.metadata)
      await audit(eventType, document.id, {
        name: document.name,
        mime_type: document.mime_type,
        size_bytes: document.size_bytes,
        indexed: true,
        chunks,
        ...extracted.metadata,
      })
      return response({ documentId: document.id, status: 'ready', indexed: true, chunks })
    } catch (error) {
      const code = error instanceof Error ? error.message : 'document_extraction_failed'
      await admin
        .from('agent_documents')
        .update({ status: 'error', approved_for_ai: false, approved_at: null, error_message: code })
        .eq('id', document.id)
        .eq('agent_id', agent.id)
        .eq('owner_id', user.id)
      await auditFailure(document.id, code)
      return response({ error: code, documentId: document.id, stored: true }, 422)
    }
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
      .select('id, metadata, source_type')
      .single()
    if (createError || !document) return response({ error: 'document_create_failed' }, 500)

    try {
      const chunks = await indexText(document, content, { extraction_parser: 'pasted-text', extracted_chars: content.length })
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
    const suppliedMime = typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : ''
    const sizeBytes = Number(body.sizeBytes)
    if (!name || !Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES || !isAllowedFile(name, suppliedMime)) {
      return response({ error: 'invalid_upload' }, 400)
    }
    const mimeType = expectedMimeType(name)
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
        metadata: { upload_pending: true, created_via: 'server', extraction_version: 1 },
      })
      .select('id')
      .single()
    if (createError || !document) return response({ error: 'document_create_failed' }, 500)

    return response({ documentId: document.id, bucket: BUCKET, path: storagePath, token: signed.token, mimeType })
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

    return await processUploadedDocument(document, 'document_uploaded_and_extracted')
  }

  if (action === 'retry_extract') {
    const document = await getDocument(body.documentId)
    if (!document || document.source_type !== 'upload' || !document.storage_path || !['processing', 'uploaded', 'error'].includes(document.status)) {
      return response({ error: 'document_not_retryable' }, 400)
    }
    await admin
      .from('agent_documents')
      .update({ status: 'processing', error_message: null, approved_for_ai: false, approved_at: null })
      .eq('id', document.id)
      .eq('agent_id', agent.id)
      .eq('owner_id', user.id)
    return await processUploadedDocument({ ...document, status: 'processing' }, 'document_extraction_retried')
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
