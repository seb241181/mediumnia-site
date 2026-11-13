// Numéro exploitable pour être rappelé (consultation à distance).
export function validPhone(value) {
  return String(value || '').replace(/\D/g, '').length >= 8
}
