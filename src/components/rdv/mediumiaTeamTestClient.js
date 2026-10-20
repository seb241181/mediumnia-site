import { createClient } from '@supabase/supabase-js'

const TEST_URL = 'https://wnbwhnqiulsdjcvkuwos.supabase.co'
const configured = import.meta.env.VITE_MEDIUMIA_TEAM_PHASE0 === 'true' &&
  import.meta.env.VITE_MEDIUMIA_TEAM_TEST_URL === TEST_URL &&
  String(import.meta.env.VITE_MEDIUMIA_TEAM_TEST_PUBLISHABLE_KEY || '').startsWith('sb_publishable_')

export const mediumiaTeamTestClient = configured ? createClient(
  TEST_URL,
  import.meta.env.VITE_MEDIUMIA_TEAM_TEST_PUBLISHABLE_KEY,
  { auth: { storageKey: 'mediumia-team-test-owner-v1', persistSession: true, autoRefreshToken: true } },
) : null

export async function readMediumiaTeamTest() {
  if (!mediumiaTeamTestClient) throw new Error('test_unavailable')
  const { data: { session } } = await mediumiaTeamTestClient.auth.getSession()
  if (!session) throw new Error('test_login_required')
  const { data, error } = await mediumiaTeamTestClient.rpc('mediumia_team_test_read_v1')
  if (error) throw new Error(error.code === '42501' ? 'test_access_denied' : 'test_read_unavailable')
  if (data?.source !== 'mediumia_test' || data?.environment !== 'TEST' ||
      data?.practitioner !== 'seb-test' || data?.contains_client_identity !== false ||
      data?.provider_verified !== false) throw new Error('test_invalid_response')
  return data
}
