// Convert telephone numbers to safe OS-provided messaging / call URLs.
// The links only open the target app; they never send or read any messages.
export function phoneActionHref(value, action = 'sms') {
  if (action !== 'sms' && action !== 'tel') return null
  const phone = String(value ?? '').trim().replace(/^\+33\s*\(0\)/, '+33').replace(/[\s().-]/g, '')
  if (!/^\+?[0-9]{6,15}$/.test(phone)) return null
  return `${action}:${phone}`
}
