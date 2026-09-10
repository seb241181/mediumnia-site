// Recovered for source control parity with the deployed legacy function.
// Phase 0 now provisions the bucket by migration; this remains compatibility-only.
import { withSupabase } from 'npm:@supabase/server'

const BUCKET = 'agent-documents'
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const { data: existing, error: lookupError } = await ctx.supabaseAdmin.storage.getBucket(BUCKET)
    if (existing) return Response.json({ ok: true, bucket: BUCKET, created: false })

    if (lookupError && !String(lookupError.message || '').toLowerCase().includes('not found')) {
      console.error('[agent-storage] result=lookup_failed')
    }

    const { data, error } = await ctx.supabaseAdmin.storage.createBucket(BUCKET, {
      public: false,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      fileSizeLimit: '25MB',
    })
    if (error) {
      const { data: retry } = await ctx.supabaseAdmin.storage.getBucket(BUCKET)
      if (retry) return Response.json({ ok: true, bucket: BUCKET, created: false })
      console.error('[agent-storage] result=create_failed')
      return Response.json({ error: 'Impossible de préparer le stockage documentaire.' }, { status: 500 })
    }

    return Response.json({ ok: true, bucket: data?.name || BUCKET, created: true })
  }),
}
