import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('document Edge function extracts PDF and modern Word files from private Storage', () => {
  const source = read('supabase/functions/agent-documents/index.ts')

  const denoConfig = read('supabase/functions/agent-documents/deno.json')
  assert.match(denoConfig, /npm:unpdf@1\.8\.1/)
  assert.match(denoConfig, /npm:fflate@0\.8\.3/)
  assert.match(denoConfig, /npm:@supabase\/supabase-js@2\.112\.3/)
  assert.match(source, /getDocumentProxy\(bytes\)/)
  assert.match(source, /extractText\(pdf, \{ mergePages: true \}\)/)
  assert.match(source, /MAX_PDF_PAGES = 400/)
  assert.match(source, /EXTRACTION_TIMEOUT_MS = 20_000/)
  assert.match(source, /unzipSync\(bytes/)
  assert.match(source, /word\/document\.xml/)
  assert.match(source, /MAX_DOCX_XML_BYTES = 10 \* 1024 \* 1024/)
  assert.match(source, /\.storage[\s\S]*\.download\(storagePath, \{\}, \{ cache: ["']no-store["'] \}\)/)
  assert.match(source, /processShadowUploadedDocument\(/)
  assert.match(source, /processLegacyUploadedDocument\(/)
})

test('uploaded documents stay disabled until extraction succeeds and Founder approves them', () => {
  const source = read('supabase/functions/agent-documents/index.ts')

  assert.match(source, /approved_for_ai: false/)
  assert.match(source, /status: ["']ready["']/)
  assert.match(source, /chunks: chunks\.length/)
  assert.match(source, /indexed_server: true/)
  assert.match(source, /event_type: ["']document_extraction_failed["']/)
  assert.match(source, /status: ["']error["'][\s\S]*approved_for_ai: false[\s\S]*approved_at: null[\s\S]*error_message: code/)
  assert.match(source, /action === ["']retry_extract["']/)
  assert.match(source, /document_extraction_retried/)
})

test('file validation rejects legacy DOC while accepting PDF DOCX and text with generic browser MIME', () => {
  const source = read('supabase/functions/agent-documents/index.ts')
  const ui = read('src/components/AgentDocuments.jsx')

  assert.match(source, /ALLOWED_EXTENSIONS = \/\\\.\(pdf\|txt\|md\|csv\|json\|docx\)\$\/i/)
  assert.doesNotMatch(source, /application\/msword/)
  assert.match(source, /application\/octet-stream/)
  assert.match(source, /expectedMimeType\(name\)/)
  assert.match(source, /looksLikePdf\(bytes\)/)
  assert.match(source, /looksLikeZip\(bytes\)/)
  assert.doesNotMatch(ui, /\.doc,/)
  assert.match(ui, /Les anciens fichiers Word \.doc doivent être réenregistrés en \.docx/)
})

test('Founder upload no longer sends extracted file text from the browser and preserves failed uploads for retry', () => {
  const ui = read('src/components/AgentDocuments.jsx')

  assert.doesNotMatch(ui, /file\.text\(\)/)
  assert.match(ui, /invokeDocumentAction\('finalize_upload', \{ documentId \}\)/)
  assert.match(ui, /let uploadCompleted = false/)
  assert.match(ui, /if \(!uploadCompleted && documentId\)/)
  assert.match(ui, /if \(uploadCompleted\)/)
  assert.match(ui, /invokeDocumentAction\('retry_extract', \{ documentId: doc\.id \}\)/)
  assert.match(ui, /Relancer l’analyse/)
  assert.match(ui, /PDF avec couche texte, Word \.docx et fichiers texte sont extraits côté serveur/)
})
