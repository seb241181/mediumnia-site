import { handleOracleTimeline } from '../lib/oracleTimeline.js'

export default async function handler(req, res) {
  return handleOracleTimeline(req, res)
}
