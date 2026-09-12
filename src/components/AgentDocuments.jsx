import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { invokeAgentDocumentAction } from '../lib/agentDocumentRequests.js'

const MAX_FILE_BYTES = 25 * 1024 * 1024

const EXTRACTION_ERROR_MESSAGES = {
  invalid_pdf_signature: 'Le fichier ne correspond pas à un PDF valide.',
  invalid_pdf: 'Ce PDF ne peut pas être analysé.',
  pdf_page_limit: 'Ce PDF dépasse la limite pilote de 400 pages.',
  pdf_extraction_timeout: 'L’analyse du PDF a pris trop de temps. Vous pouvez la relancer.',
  pdf_no_extractable_text: 'Aucun texte exploitable détecté. Le PDF est probablement scanné ou composé d’images.',
  invalid_docx_signature: 'Le fichier ne correspond pas à un document Word .docx valide.',
  invalid_docx: 'Ce document Word .docx ne peut pas être analysé.',
  docx_document_xml_missing: 'Le contenu principal du document Word est introuvable.',
  docx_no_extractable_text: 'Aucun texte exploitable détecté dans ce document Word.',
  text_too_large: 'Le texte extrait dépasse la limite pilote de la mémoire documentaire.',
  empty_document_text: 'Aucun texte exploitable détecté dans ce fichier.',
  storage_download_failed: 'Le fichier privé n’a pas pu être relu pour l’analyse.',
  stored_file_too_large: 'Le fichier dépasse la limite d’analyse autorisée.',
}

function statusLabel(doc) {
  if (doc.status === 'ready') return doc.approved_for_ai ? 'Utilisé par le copilote' : 'Prêt à valider'
  if (doc.status === 'processing') return 'Analyse en cours'
  if (doc.status === 'error') return 'Analyse à relancer'
  if (doc.status === 'archived') return 'Archivé'
  return 'Stocké — analyse à relancer'
}

function sizeLabel(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function errorLabel(code) {
  return EXTRACTION_ERROR_MESSAGES[code] || code || 'L’analyse de ce document a échoué.'
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
  const pendingRequestIds = useRef(new Map())

  async function invokeDocumentAction(action, payload = {}) {
    return invokeAgentDocumentAction({
      action,
      agentId,
      payload,
      pendingRequestIds: pendingRequestIds.current,
      invoke: (body) => supabase.functions.invoke('agent-documents', { body }),
    })
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

  const loadDocumentsForAgent = useEffectEvent(loadDocuments)
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDocumentsForAgent() }, 0)
    return () => window.clearTimeout(timer)
  }, [agentId])

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

    const mimeType = (file.type || 'application/octet-stream').toLowerCase()
    setBusy(true)
    let documentId = null
    let uploadCompleted = false
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
          contentType: prepared.mimeType || mimeType,
          upsert: false,
        })
      if (uploadError) {
        try {
          const finalized = await invokeDocumentAction('finalize_upload', { documentId })
          uploadCompleted = true
          setInfo(finalized.indexed
            ? 'Document extrait et analysé côté serveur. Validez-le pour autoriser le copilote à l’utiliser.'
            : 'Document stocké en privé. Relancez l’analyse pour créer sa mémoire exploitable.')
          await loadDocuments()
          return
        } catch (finalizeError) {
          if (finalizeError.stored) uploadCompleted = true
          throw finalizeError.stored ? finalizeError : uploadError
        }
      }
      uploadCompleted = true

      const finalized = await invokeDocumentAction('finalize_upload', { documentId })
      setInfo(finalized.indexed
        ? 'Document extrait et analysé côté serveur. Validez-le pour autoriser le copilote à l’utiliser.'
        : 'Document stocké en privé. Relancez l’analyse pour créer sa mémoire exploitable.')
      await loadDocuments()
    } catch (err) {
      if (!uploadCompleted && documentId) {
        try { await invokeDocumentAction('delete', { documentId }) } catch { /* best-effort cleanup */ }
      }
      if (uploadCompleted) {
        await loadDocuments()
        setError('Le fichier est bien stocké en privé, mais son analyse automatique n’a pas abouti. Utilisez « Relancer l’analyse ».')
      } else {
        setError(err.message || 'Impossible d’ajouter ce document.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function retryExtraction(doc) {
    if (busy || doc.source_type !== 'upload') return
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const result = await invokeDocumentAction('retry_extract', { documentId: doc.id })
      setInfo(result.indexed
        ? 'Analyse terminée. Validez maintenant la source pour autoriser le copilote à l’utiliser.'
        : 'Le fichier reste stocké en privé, mais son analyse n’est pas terminée.')
      await loadDocuments()
    } catch {
      await loadDocuments()
      setError('L’analyse n’a pas abouti. Le fichier reste stocké en privé ; aucun accès n’a été accordé au copilote.')
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
            Vos sources restent privées. PDF avec couche texte, Word .docx et fichiers texte sont extraits côté serveur ; une source n’est utilisable par le copilote qu’après votre validation explicite.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`font-georgia text-sm px-5 py-2.5 rounded-lg bg-gold text-deep font-bold cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            + Ajouter un fichier
            <input
              type="file"
              className="hidden"
              onChange={uploadFile}
              accept=".pdf,.txt,.md,.csv,.json,.docx,application/pdf,text/plain,text/markdown,text/csv,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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

      <div className="rounded-xl border border-gold/20 bg-gold/5 p-4 mb-6 space-y-1">
        <p className="font-georgia text-sm text-deep">
          <strong>Règle MediumIA :</strong> analysé ≠ autorisé. Vous décidez source par source si le copilote peut l’utiliser.
        </p>
        <p className="font-georgia text-xs text-mist">
          Les anciens fichiers Word .doc doivent être réenregistrés en .docx. Un PDF scanné sans couche texte reste privé mais nécessite un futur moteur OCR pour être exploitable.
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
                  <p className="font-georgia text-xs text-mist/70 mt-2">Fichier conservé en privé. Relancez l’analyse pour créer ses extraits de mémoire.</p>
                )}
                {doc.status === 'error' && doc.error_message && (
                  <p className="font-georgia text-xs text-red-500 mt-2">{errorLabel(doc.error_message)}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 md:justify-end">
                {doc.source_type === 'upload' && ['processing', 'uploaded', 'error'].includes(doc.status) && (
                  <button
                    type="button"
                    onClick={() => retryExtraction(doc)}
                    disabled={busy}
                    className="font-georgia text-xs px-4 py-2.5 rounded-lg border border-gold/40 text-deep font-bold disabled:opacity-35"
                  >
                    Relancer l’analyse
                  </button>
                )}
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
        Sécurité pilote : le fichier est envoyé avec un jeton signé lié à un chemin aléatoire précis. L’Edge Function authentifiée relit ensuite le fichier privé, extrait le texte, crée les chunks et les conserve désactivés pour l’IA jusqu’à votre validation.
      </p>
    </div>
  )
}
