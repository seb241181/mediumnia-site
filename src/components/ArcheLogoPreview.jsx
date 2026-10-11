import { useState } from 'react'
import './ArcheLogoPreview.css'

const PROPOSALS = [
  { id: 'passage', name: 'Passage', description: 'Une arche ouverte, une lumière au centre.' },
  { id: 'refuge', name: 'Refuge', description: 'Deux courbes qui accueillent une présence.' },
  { id: 'habite', name: 'A habité', description: 'Un A arrondi, traversé par une lueur.' },
]

export function ArcheLogoSymbol({ variant }) {
  return <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className="arche-logo-symbol">
    {variant === 'passage' && <>
      <path d="M10 38V24a14 14 0 0 1 28 0v14" stroke="#20233F" strokeWidth="4" strokeLinecap="round"/>
      <path d="M18 37V25a6 6 0 0 1 12 0v12" stroke="#B49450" strokeWidth="2.4" strokeLinecap="round"/>
      <circle cx="24" cy="30" r="2.5" fill="#B49450"/>
    </>}
    {variant === 'refuge' && <>
      <path d="M18 10C7 14 5 26 11 34c3 4 7 5 10 5M30 10c11 4 13 16 7 24-3 4-7 5-10 5" stroke="#20233F" strokeWidth="4" strokeLinecap="round"/>
      <circle cx="24" cy="22" r="4" fill="#B49450"/>
      <path d="M17 32c2-5 12-5 14 0" stroke="#B49450" strokeWidth="2.8" strokeLinecap="round"/>
    </>}
    {variant === 'habite' && <>
      <path d="m9 38 10-25c2-5 8-5 10 0l10 25" stroke="#20233F" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16 29c5-3 11-3 16 0" stroke="#B49450" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="24" cy="36" r="2.4" fill="#B49450"/>
    </>}
  </svg>
}

// Sélecteur artistique local, affiché uniquement dans la messagerie de démonstration.
export default function ArcheLogoPreview() {
  const [selected, setSelected] = useState('passage')
  const proposal = PROPOSALS.find(item => item.id === selected)
  return <div className="arche-logo-preview" data-logo-proposal={selected}>
    <details onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus() } }}>
      <summary aria-label="Comparer les propositions du logo L’ARCHE" title={'Logo '+proposal.name+' · comparer les propositions'}>
        <ArcheLogoSymbol variant={selected}/><strong>L’ARCHE</strong>
      </summary>
      <div className="arche-logo-choices">
        <p>Trois symboles pour L’Arche</p>
        {PROPOSALS.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={event => { setSelected(item.id); const details = event.currentTarget.closest('details'); details.open = false; details.querySelector('summary').focus() }}>
          <ArcheLogoSymbol variant={item.id}/><span><strong>{item.name}</strong><span>{item.description}</span></span>
        </button>)}
      </div>
    </details>
    <span className="arche-logo-demo">Démo</span>
  </div>
}
