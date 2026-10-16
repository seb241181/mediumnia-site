export default function SettledBookings({ count, children }) {
  if (!count) return null
  return (
    <details className="mt-4 border-t border-emerald-200 pt-3">
      <summary className="min-h-11 cursor-pointer py-3 font-georgia text-sm font-semibold text-emerald-800">
        Rendez-vous intégralement réglés ({count})
      </summary>
      {children}
    </details>
  )
}
