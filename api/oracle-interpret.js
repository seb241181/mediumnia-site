/* global process */
import { handleOracleTimeline } from '../lib/oracleTimeline.js'
import { handleOracleFollowPayPal } from '../lib/oracleFollowPayPal.js'

export default async function handler(req, res) {
  const followAction = typeof req.query?.followAction === 'string' ? req.query.followAction.trim() : ''
  if (followAction) return handleOracleFollowPayPal(req, res, followAction)
  return handleOracleTimeline(req, res)
}
