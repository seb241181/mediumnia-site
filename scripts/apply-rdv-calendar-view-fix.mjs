import fs from 'node:fs'

const path = 'src/components/rdv/RdvPublic.jsx'
let text = fs.readFileSync(path, 'utf8')

const oldViewState = "  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))"
const newViewState = `  const [viewDate, setViewDate] = useState(() => selected
    ? new Date(selected.getFullYear(), selected.getMonth(), 1)
    : new Date(today.getFullYear(), today.getMonth(), 1))

  useEffect(() => {
    if (selected) {
      setViewDate(new Date(selected.getFullYear(), selected.getMonth(), 1))
    }
  }, [selected])`

if (!text.includes(newViewState)) {
  if (!text.includes(oldViewState)) {
    throw new Error(`Expected CalendarPicker anchor not found in ${path}`)
  }
  text = text.replace(oldViewState, newViewState)
}

text = text.replace("Voir d'autres dates</button>", "Voir d'autres dates disponibles</button>")

fs.writeFileSync(path, text)
console.log('MediumIA RDV: calendar view aligned with suggested availability')
