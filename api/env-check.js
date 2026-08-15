export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  return res.status(200).json({
    vercelEnv: process.env.VERCEL_ENV || null,
    vercelGitCommitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
    hasAnthropicApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasClaudeApiKey: Boolean(process.env.CLAUDE_API_KEY),
    hasCleApiAnthropic: Boolean(process.env.CLE_API_ANTHROPIC),
    hasSupabaseUrl: Boolean(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL),
    hasSupabasePublishableKey: Boolean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY),
  })
}
