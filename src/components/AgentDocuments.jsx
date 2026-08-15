import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json'])
const MAX_FILE_BYTES = 25 * 1024 * 1024

function safeFileName(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140) || 'document'
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

function statusLabel(doc) {
  if (doc.status === 'ready') return doc.approved_for_ai ? 'Utilisé par l’agent' : 'Prêt à valider'
  if (doc.status === 'processing') return 'Analyse en cours'
  if (doc.status === 'error') return 'Erreur'
  if (doc.status === 'archived') return 'Archivé'
  return 'Stocké'
}

export default function AgentDocuments({ agentId }) {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteName, setPasteName] = useState('')
  const [pasteContent, setPasteContent] = useState('')

  async function getUser() {
    const { data } = await supabase.auth.getUser()
    return data?.user || null
  }

  async function audit(userId, eventType, resourceType, resourceId, details = {}) {
    await supabase.from('agent_audit_events').insert({
      owner_id: userId,
      agent_id: agentId,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: resourceId ? String(resourceId) : null,
      details,
    })
  }

  async function loadDocuments() {
    if (!supabase || !agentId) return
    setLoading(true); setError('')
    const { data, error: loadError } = await supabase
      .from('agent_documents')
      .select('id, name, source_type, storage_bucket, storage_path, mime_type, size_bytes, status, approved_for_ai, approved_at, sensitivity, error_message, created_at')
      .eq('agent_id', agentId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
    if (loadError) setError(loadError.message)
    else setDocuments(data || [])
    setLoading(false)
  }

  useEffect(() => { loadDocuments() }, [agentId])

  async function indexPlainText(documentId, userId, text) {
    const chunks = chunkText(text)
    if (!chunks.length) throw new Error('Aucun texte exploitable trouvé dans ce document.')
    const rows = chunks.map((content, chunkIndex) => ({
      document_id: documentId,
      agent_id: agentId,
      owner_id: userId,
      chunk_index: chunkIndex,
      content,
    }))
    const { error: chunkError } = await supabase.from('agent_document_chunks').insert(rows)
    if (chunkError) throw chunkError
    const { error: updateError } = await supabase
      .from('agent_documents')
      .update({ status: 'ready', error_message: null, metadata: { chunks: chunks.length, indexed_locally: true } })
      .eq('id', documentId)
    if (updateError) throw updateError
    return chunks.length
  }

  async function uploadFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    setError(''); setInfo('')
    if (file.size > MAX_FILE_BYTES) { setError('Document trop volumineux : 25 Mo maximum.'); return }

    setBusy(true)
    let storagePath = null
    let createdDocumentId = null
    try {
      const user = await getUser()
      if (!user) throw new Error('Votre session a expiré.')

      const { error: bucketError } = await supabase.functions.invoke('ensure-agent-documents-bucket', { body: {} })
      if (bucketError) throw new Error('Le stockage privé MediumIA n’a pas pu être préparé.')

      storagePath = `${user.id}/${agentId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from('agent-documents')
        .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false })
      if (uploadError) throw uploadError

      const { data: document, error: documentError } = await supabase
        .from('agent_documents')
        .insert({
          agent_id: agentId,
          owner_id: user.id,
          name: file.name,
          source_type: 'upload',
          storage_bucket: 'agent-documents',
          storage_path: storagePath,
          mime_type: file.type || null,
          size_bytes: file.size,
          status: 'uploaded',
          approved_for_ai: false,
          sensitivity: 'confidential',
        })
        .select('id')
        .single()
      if (documentError) throw documentError
      createdDocumentId = document.id

      let indexed = false
      let chunks = 0
      if (TEXT_TYPES.has(file.type) || /\.(txt|md|csv|json)$/i.test(file.name)) {
        const text = await file.text()
        chunks = await indexPlainText(document.id, user.id, text)
        indexed = true
      }

      await audit(user.id, 'document_uploaded', 'document', document.id, {
        name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        indexed,
        chunks,
      })

      setInfo(indexed
        ? 'Document analysé. Il n’est pas encore utilisé par l’agent : validez-le d’abord.'
        : 'Document stocké en privé. Les PDF/Word seront analysés par le moteur documentaire à l’étape suivante.')
      await loadDocuments()
    } catch (err) {
      if (createdDocumentId) {
        await supabase.from('agent_documents').update({ status: 'error', error_message: err.message || 'Erreur de traitement' }).eq('id', createdDocumentId)
      } else if (storagePath) {
        await supabase.storage.from('agent-documents').remove([storagePath])
      }
      setError(err.message || 'Impossible d’ajouter ce document.')
    } finally {
      setBusy(false)
    }
  }

  async function addPastedSource(e) {
    e.preventDefault()
    const name = pasteName.trim()
    const content = pasteContent.trim()
    if (!name || !content || busy) return
    setBusy(true); setError(''); setInfo('')
    try {
      const user = await getUser()
      if (!user) throw new Error('Votre session a expiré.')
      const { data: document, error: documentError } = await supabase
        .from('agent_documents')
        .insert({
          agent_id: agentId,
          owner_id: user.id,
          name,
          source_type: 'paste',
          status: 'processing',
          approved_for_ai: false,
          sensitivity: 'confidential',
        })
        .select('id')
        .single()
      if (documentError) throw documentError
      const chunks = await indexPlainText(document.id, user.id, content)
      await audit(user.id, 'document_created_from_text', 'document', document.id, { name, chunks })
      setPasteName(''); setPasteContent(''); setPasteOpen(false)
      setInfo('Source créée et analysée. Validez-la pour autoriser l’agent à l’utiliser.')
      await loadDocuments()
    } catch (err) {
      setError(err.message || 'Impossible d’ajouter cette source.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleApproval(doc) {
    if (busy || doc.status !== 'ready') return
    setBusy(true); setError(''); setInfo('')
    try {
      const user = await getUser()
      if (!user) throw new Error('Votre session a expiré.')
      const next = !doc.approved_for_ai
      const { error: updateError } = await supabase
        .from('agent_documents')
        .update({ approved_for_ai: next, approved_at: next ? new Date().toISOString() : null })
        .eq('id', doc.id)
      if (updateError) throw updateError
      await audit(user.id, next ? 'document_approved_for_ai' : 'document_revoked_from_ai', 'document', doc.id, { name: doc.name })
      setInfo(next ? 'Source autorisée : l’agent peut maintenant s’en servir.' : 'Autorisation retirée : l’agent n’utilisera plus cette source.')
      await loadDocuments()
    } catch (err) {
      setError(err.message || 'Impossible de modifier cette autorisation.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteDocument(doc) {
    if (busy) return
    setBusy(true); setError(''); setInfo('')
    try {
      const user = await getUser()
      if (!user) throw new Error('Votre session a expiré.')
      if (doc.storage_path) {
        const { error: storageError } = await supabase.storage.from(doc.storage_bucket || 'agent-documents').remove([doc.storage_path])
        if (storageError) throw storageError
      }
      const { error: deleteError } = await supabase.from('agent_documents').delete().eq('id', doc.id)
      if (deleteError) throw deleteError
      await audit(user.id, 'document_deleted', 'document', doc.id, { name: doc.name })
      setInfo('Document supprimé de MediumIA.')
      await loadDocuments()
    } catch (err) {
      setError(err.message || 'Impossible de supprimer ce document.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 md:px-8 py-7">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5 mb-7">
        <div>
          <p className="font-georgia text-gold text-xs tracking-[0.2em] uppercase mb-2">Mémoire métier</p>
          <h3 className="font-georgia text-2xl text-deep mb-2">Documents & sources</h3>
          <p className="font-georgia text-sm text-mist max-w-2xl leading-relaxed">Tout reste privé. Une source n’est transmise à l’IA qu’après votre validation explicite, et seulement par extraits utiles à la question.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`font-georgia text-sm px-5 py-2.5 rounded-lg bg-gold text-deep font-bold cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            + Ajouter un fichier
            <input type="file" className="hidden" onChange={uploadFile} accept=".pdf,.txt,.md,.csv,.json,.doc,.docx,application/pdf,text/plain,text/markdown,text/csv,application/json,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
          </label>
          <button onClick={() => setPasteOpen((value) => !value)} disabled={busy} className="font-georgia text-sm px-5 py-2.5 rounded-lg border border-gold/40 text-deep font-bold disabled:opacity-50">Coller du contenu</button>
        </div>
      </div>

      <div className="rounded-xl border border-gold/20 bg-gold/5 p-4 mb-6">
        <p className="font-georgia text-sm text-deep"><strong>Règle MediumIA :</strong> stockage ≠ autorisation. Après analyse, vous décidez source par source si l’agent peut l’utiliser.</p>
      </div>

      {pasteOpen && (
        <form onSubmit={addPastedSource} className="rounded-2xl border border-gold/25 bg-white p-5 mb-6 space-y-4">
          <div>
            <label className="font-georgia text-xs text-mist uppercase tracking-wider block mb-1.5">Nom de la source</label>
            <input value={pasteName} onChange={(e) => setPasteName(e.target.value)} maxLength={240} placeholder="Ex. Tarifs 2026, FAQ clients, méthode interne…" className="w-full rounded-lg border border-gold/25 px-4 py-3 font-georgia outline-none focus:border-gold/60" />
          </div>
          <div>
            <label className="font-georgia text-xs text-mist uppercase tracking-wider block mb-1.5">Contenu</label>
            <textarea rows="8" value={pasteContent} onChange={(e) => setPasteContent(e.target.value)} placeholder="Collez ici le texte que l’agent pourra apprendre après votre validation…" className="w-full rounded-lg border border-gold/25 px-4 py-3 font-georgia outline-none focus:border-gold/60 leading-relaxed" />
          </div>
          <button type="submit" disabled={busy || !pasteName.trim() || !pasteContent.trim()} className="font-georgia px-6 py-3 rounded-lg bg-deep text-gold font-bold disabled:opacity-40">Créer la source</button>
        </form>
      )}

      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 mb-5"><p className="font-georgia text-sm text-red-600">{error}</p></div>}
      {info && <div className="rounded-xl bg-gold/10 border border-gold/25 px-4 py-3 mb-5"><p className="font-georgia text-sm text-deep">{info}</p></div>}

      {loading ? (
        <p className="font-georgia text-mist text-center py-12">Chargement des sources…</p>
      ) : documents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gold/35 p-10 text-center">
          <p className="text-gold text-4xl mb-3">◇</p>
          <p className="font-georgia text-xl text-deep mb-2">Aucune source métier.</p>
          <p className="font-georgia text-sm text-mist">Ajoutez un fichier ou collez du contenu. Rien ne sera utilisé par l’agent avant votre validation.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <article key={doc.id} className="rounded-2xl border border-gold/20 bg-white/70 p-5 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h4 className="font-georgia text-deep font-bold truncate max-w-full">{doc.name}</h4>
                  <span className={`font-georgia text-[10px] uppercase tracking-wider rounded-full px-2.5 py-1 ${doc.approved_for_ai ? 'bg-deep text-gold' : 'bg-gold/10 text-mist'}`}>{statusLabel(doc)}</span>
                </div>
                <p className="font-georgia text-xs text-mist">{doc.source_type === 'paste' ? 'Texte MediumIA' : (doc.mime_type || 'Fichier')} · {doc.sensitivity === 'restricted' ? 'restreint' : 'confidentiel'}</p>
                {doc.error_message && <p className="font-georgia text-xs text-red-500 mt-2">{doc.error_message}</p>}
                {doc.status === 'uploaded' && !TEXT_TYPES.has(doc.mime_type) && <p className="font-georgia text-xs text-mist mt-2">Fichier conservé en privé ; extraction PDF/Word à connecter.</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {doc.status === 'ready' && (
                  <button onClick={() => toggleApproval(doc)} disabled={busy} className={`font-georgia text-xs px-4 py-2.5 rounded-lg font-bold disabled:opacity-40 ${doc.approved_for_ai ? 'border border-gold/35 text-deep' : 'bg-deep text-gold'}`}>
                    {doc.approved_for_ai ? 'Retirer à l’agent' : 'Autoriser l’agent'}
                  </button>
                )}
                <button onClick={() => deleteDocument(doc)} disabled={busy} className="font-georgia text-xs px-3 py-2.5 rounded-lg text-red-500 border border-red-200 disabled:opacity-40">Supprimer</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="font-georgia text-[11px] text-mist/60 mt-6">Fichiers jusqu’à 25 Mo. TXT, Markdown, CSV et JSON sont analysés immédiatement. PDF et Word sont déjà stockés de façon privée ; leur extraction automatique arrive dans la prochaine passe.</p>
    </div>
  )
}
