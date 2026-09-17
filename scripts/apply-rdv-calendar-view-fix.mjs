import fs from 'node:fs'

const path = 'src/components/rdv/RdvPublic.jsx'
let text = fs.readFileSync(path, 'utf8')

const oldViewState = "  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))"
const newViewState = `  const [viewDate, setViewDate] = useState(() => selected
    ? new Date(selected.getFullYear(), selected.getMonth(), 1)
    : new Date(today.getFullYear(), today.getMonth(), 1))`

if (!text.includes(newViewState)) {
  if (!text.includes(oldViewState)) {
    throw new Error(`Expected CalendarPicker anchor not found in ${path}`)
  }
  text = text.replace(oldViewState, newViewState)
}

const oldRefBlock = `  const dayAvailRef = useRef(dayAvail)
  dayAvailRef.current = dayAvail`
const newRefBlock = `  const dayAvailRef = useRef(dayAvail)
  dayAvailRef.current = dayAvail
  const autoAdvanceRef = useRef(true)

  useEffect(() => {
    autoAdvanceRef.current = true
    const base = selected || new Date()
    setViewDate(new Date(base.getFullYear(), base.getMonth(), 1))
  }, [serviceSlug]) // eslint-disable-line react-hooks/exhaustive-deps`

if (!text.includes(newRefBlock)) {
  if (!text.includes(oldRefBlock)) {
    throw new Error(`Expected calendar availability ref anchor not found in ${path}`)
  }
  text = text.replace(oldRefBlock, newRefBlock)
}

const oldRunStart = `    async function run() {
      for (let i = 0; i < candidates.length; i += 5) {`
const newRunStart = `    async function run() {
      let monthHasAvailability = candidates.some(d => dayAvailRef.current[toDateStr(d)] === true)

      for (let i = 0; i < candidates.length; i += 5) {`

if (!text.includes(newRunStart)) {
  if (!text.includes(oldRunStart)) {
    throw new Error(`Expected calendar run anchor not found in ${path}`)
  }
  text = text.replace(oldRunStart, newRunStart)
}

const oldUpdateLoop = `        const update = {}
        for (const r of results) {
          if (r) update[r.dateStr] = r.has
        }
        if (Object.keys(update).length > 0) onDayAvailUpdate(update)
      }
      if (!cancelled) setLoadingMonths(prev => ({ ...prev, [monthKey]: false }))`
const newUpdateLoop = `        const update = {}
        for (const r of results) {
          if (r) {
            update[r.dateStr] = r.has
            if (r.has === true) monthHasAvailability = true
          }
        }
        if (Object.keys(update).length > 0) onDayAvailUpdate(update)
      }

      if (!cancelled) {
        setLoadingMonths(prev => ({ ...prev, [monthKey]: false }))
        if (autoAdvanceRef.current) {
          if (monthHasAvailability) {
            autoAdvanceRef.current = false
          } else {
            const nextMonth = new Date(year, month + 1, 1)
            if (nextMonth <= maxDate) {
              setViewDate(nextMonth)
            } else {
              autoAdvanceRef.current = false
            }
          }
        }
      }`

if (!text.includes(newUpdateLoop)) {
  if (!text.includes(oldUpdateLoop)) {
    throw new Error(`Expected calendar update anchor not found in ${path}`)
  }
  text = text.replace(oldUpdateLoop, newUpdateLoop)
}

const oldLoading = `<p className="mt-3 pt-3 border-t border-gold/10 font-georgia text-[10px] text-mist/40 text-right">Vérification des disponibilités…</p>`
const newLoading = `<div className="mt-4 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 flex items-center justify-center gap-2.5 shadow-sm">
          <span className="w-4 h-4 border-2 border-gold/30 border-t-gold rounded-full animate-spin shrink-0" />
          <p className="font-georgia text-sm font-semibold text-deep">Recherche des prochaines disponibilités…</p>
        </div>`

if (!text.includes(newLoading)) {
  if (!text.includes(oldLoading)) {
    throw new Error(`Expected availability loading label not found in ${path}`)
  }
  text = text.replace(oldLoading, newLoading)
}

text = text.replace("Voir d'autres dates</button>", "Voir d'autres dates disponibles</button>")

fs.writeFileSync(path, text)
console.log('MediumIA RDV: calendar opens on the first month with availability')
