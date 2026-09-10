import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json'])
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_INLINE_TEXT_BYTES = 750_000

function statusLabel(doc) {
  if (doc.status === 'ready') return doc.approved_for_ai ? 'Utilisé par le copilote' : 'Prêt à valider'
  if (doc.status === 'processing') return 'Préparation en cours'
  if (doc.status === 'error') return 'Erreur'
  if (doc.status === 'archived') return 'Archivé'
  return 'Stocké — analyse à venir'
}

function sizeLabel(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
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

  async function invokeDocumentAction(action, payload = {}) {
    const { data, error: functionError } = await supabase.functions.invoke('agent-documents', {
      body: { action, agentId, ...payload },
    })
    if (functionError) throw new Error(functionError.message || 'Action documentaire indisponible.')
    if (data?.error) throw new Error(data.error)
    return data || {}
  }

  async function loadDocuments() {
    if (!supabase || !agentId) return
    setLoading(true)
    setError('')
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

  async function uploadFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return

    setError('')
    setInfo('')
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      setError('Document invalide ou trop volumineux : 25 Mo maximum.')
      return
    }

    const mimeType = (file.type || '').toLowerCase()
    if (!mimeType) {
      setError('Type de fichier indéterminé. Utilisez PDF, TXT, Markdown, CSV, JSON, DOC ou DOCX.')
      return
    }

    setBusy(true)
    let documentId = null
    try {
      const prepared = await invokeDocumentAction('prepare_upload', {
        name: file.name,
        mimeType,
        sizeBytes: file.size,
      })
      documentId = prepared.documentId
      if (!documentId || !prepared.bucket || !prepared.path || !prepared.token) throw new Error('signed_upload_incomplete')

      const { error: uploadError } = await supabase.storage
        .from(prepared.bucket)
        .uploadToSignedUrl(prepared.path, prepared.token, file, {
          contentType: mimeType,
          upsert: false,
        })
      if (uploadError) throw uploadError

      const canIndexInline = file.size <= MAX_INLINE_TEXT_BYTES
        && TEXT_TYPES.has(mimeType)
        && /\.(txt|md|csv|json)$/i.test(file.name)
      const content = canIndexInline ? await file.text() : undefined
      const finalized = await invokeDocumentAction('finalize_upload', {
        documentId,
        ...(content !== undefined ? { content } : {}),
      })

      setInfo(finalized.indexed
        ? 'Document analysé côté serveur. Validez-le pour autoriser le copilote à l’utiliser.'
        : 'Document stocké en privé. Les PDF/Word et gros fichiers seront analysés lors de la prochaine étape du moteur documentaire.')
      await loadDocuments()
    } catch (err) {
      if (documentId) {
        try { await invokeDocumentAction('delete', { documentId }) } catch { /* best-effort cleanup */ }
      }
      setError(err.message || 'Impossible d’ajouter ce document.')
    } finally {
      setBusy(false)
    }
  }

  async function addPastedSource(event) {
    event.preventDefault()
    const name = pasteName.trim()
    const content = pasteContent.trim()
    if (!name || !content || busy) return

    setBusy(true)
    setError('')
    setInfo('')
    try {
      await invokeDocumentAction('create_text', { name, content })
      setPasteName('')
      setPasteContent('')
      setPasteOpen(false)
      setInfo('Source créée et analysée côté serveur. Validez-la pour autoriser le copilote à l’utiliser.')
      await loadDocuments()
    } catch (err) {
      setError(err.message || 'Impossible d’ajouter cette source.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleApproval(doc) {
    if (busy || doc.status !== 'ready') return
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const approved = !doc.approved_for_ai
      await invokeDocumentAction('set_approval', { documentId: doc.id, approved })
      setInfo(approved
        ? 'Source autorisée : le copilote peut maintenant en utiliser des extraits pertinents.'
        : 'Autorisation retirée : cette source ne sera plus transmise au copilote.')
      await loadDocuments()
    } catch (err) {
      setError(err.message || 'Impossible de modifier cette autorisation.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteDocument(doc) {
    if (busy) return
    const confirmed = window.confirm(`Supprimer « ${doc.name} » de MediumIA ?`)
    if (!confirmed) return

    setBusy(true)
    setError('')
    setInfo('')
    try {
      await invokeDocumentAction('delete', { documentId: doc.id })
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
          <p className="font-georgia text-gold text-xs tracking-[0.2em] uppercase mb-2">Mémoire métier sécurisée</p>
          <h3 className="font-georgia text-2xl text-deep mb-2">Documents & sources</h3>
          <p className="font-georgia text-sm text-mist max-w-2xl leading-relaxed">
            Vos sources restent privées. Les écritures passent par le serveur MediumIA et une source n’est utilisable par le copilote qu’après votre validation explicite.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`font-georgia text-sm px-5 py-2.5 rounded-lg bg-gold text-deep font-bold cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            + Ajouter un fichier
            <input
              type="file"
              className="hidden"
              onChange={uploadFile}
              accept=".pdf,.txt,.md,.csv,.json,.doc,.docx,application/pdf,text/plain,text/markdown,text/csv,application/json,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            />
          </label>
          <button
            type="button"
            onClick={() => setPasteOpen((value) => !value)}
            disabled={busy}
            className="font-georgia text-sm px-5 py-2.5 rounded-lg border border-gold/40 text-deep font-bold disabled:opacity-50"
          >
            Coller du contenu
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gold/20 bg-gold/5 p-4 mb-6">
        <p className="font-georgia text-sm text-deep">
          <strong>Règle MediumIA :</strong> stocké ≠ autorisé. Même après analyse, vous décidez source par source si le copilote peut l’utiliser.
        </p>
      </div>

      {pasteOpen && (
        <form onSubmit={addPastedSource} className="rounded-2xl border border-gold/25 bg-white p-5 mb-6 space-y-4">
          <div>
            <label className="font-georgia text-xs text-mist uppercase tracking-wider block mb-1.5">Nom de la source</label>
            <input
              value={pasteName}
              onChange={(event) => setPasteName(event.target.value)}
              maxLength={240}
              placeholder="Ex. Tarifs 2026, FAQ clients, méthode interne…"
              className="w-full rounded-lg border border-gold/25 px-4 py-3 font-georgia outline-none focus:border-gold/60"
            />
          </div>
          <div>
            <label className="font-georgia text-xs text-mist uppercase tracking-wider block mb-1.5">Contenu</label>
            <textarea
              rows="8"
              value={pasteContent}
              onChange={(event) => setPasteContent(event.target.value)}
              maxLength={750000}
              placeholder="Collez ici le texte que le copilote pourra utiliser après votre validation…"
              className="w-full rounded-lg border border-gold/25 px-4 py-3 font-georgia outline-none focus:border-gold/60 leading-relaxed"
            />
          </div>
          <button type="submit" disabled={busy || !pasteName.trim() || !pasteContent.trim()} className="font-georgia px-6 py-3 rounded-lg bg-deep text-gold font-bold disabled:opacity-40">
            {busy ? 'Sécurisation…' : 'Créer la source'}
          </button>
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
          <p className="font-georgia text-sm text-mist">Ajoutez un fichier ou collez du contenu. Rien ne sera utilisé avant votre validation.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <article key={doc.id} className="rounded-2xl border border-gold/20 bg-white/70 p-5 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h4 className="font-georgia text-deep font-bold truncate max-w-full">{doc.name}</h4>
                  <span className={`font-georgia text-[10px] uppercase tracking-wider rounded-full px-2.5 py-1 ${doc.approved_for_ai ? 'bg-gold/20 text-deep' : 'bg-deep/5 text-mist'}`}>
                    {statusLabel(doc)}
                  </span>
                </div>
                <p className="font-georgia text-xs text-mist">
                  {doc.source_type === 'paste' ? 'Texte collé' : 'Fichier privé'}
                  {doc.mime_type ? ` · ${doc.mime_type}` : ''}
                  {sizeLabel(doc.size_bytes) ? ` · ${sizeLabel(doc.size_bytes)}` : ''}
                </p>
                {doc.status === 'uploaded' && (
                  <p className="font-georgia text-xs text-mist/70 mt-2">Stockage terminé. L’extraction PDF/Word sera activée dans l’étape documentaire suivante.</p>
                )}
                {doc.status === 'error' && doc.error_message && (
                  <p className="font-georgia text-xs text-red-500 mt-2">{doc.error_message}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 md:justify-end">
                <button
                  type="button"
                  onClick={() => toggleApproval(doc)}
                  disabled={busy || doc.status !== 'ready'}
                  className={`font-georgia text-xs px-4 py-2.5 rounded-lg font-bold disabled:opacity-35 ${doc.approved_for_ai ? 'border border-gold/40 text-deep' : 'bg-deep text-gold'}`}
                >
                  {doc.approved_for_ai ? 'Retirer de la mémoire' : 'Autoriser le copilote'}
                </button>
                <button
                  type="button"
                  onClick={() => deleteDocument(doc)}
                  disabled={busy}
                  className="font-georgia text-xs px-4 py-2.5 rounded-lg border border-red-200 text-red-500 disabled:opacity-35"
                >
                  Supprimer
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="font-georgia text-[11px] text-mist/60 mt-6 leading-relaxed">
        Sécurité pilote : les métadonnées et extraits sont écrits par la fonction serveur authentifiée. Pour les fichiers, le navigateur reçoit uniquement un jeton signé lié à un chemin aléatoire précis ; aucune clé privilégiée n’est exposée.
      </p>
    </div>
  )
}
