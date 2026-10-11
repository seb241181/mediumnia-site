import { useState } from 'react'
import './ArcheLogoPreview.css'

const PROPOSALS = [
  { id: 'regard', name: 'Regard refuge', description: 'L’œil MediumIA accueilli sous une arche douce.' },
  { id: 'porte', name: 'Porte ouverte', description: 'Une ouverture lumineuse au cœur du regard.' },
  { id: 'lueur', name: 'Lueur partagée', description: 'Un regard vivant, une lumière qui rayonne.' },
]

export function ArcheLogoSymbol({ variant }) {
  return <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className="arche-logo-symbol">
    {variant === 'regard' && <>
      <path d="M6 34C8 22 14 12 24 12s16 10 18 22" stroke="#17233F" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M11 31c7-8 19-9 26 0-7 8-19 8-26 0Z" stroke="#B49450" strokeWidth="1.9" strokeLinejoin="round"/>
      <circle cx="24" cy="30.5" r="4.3" fill="#17233F"/>
      <circle cx="25.3" cy="29.2" r="1.2" fill="#F3D997"/>
      <path d="M24 5v3M14 8l1.5 2M34 8l-1.5 2" stroke="#B49450" strokeWidth="1.5" strokeLinecap="round"/>
    </>}
    {variant === 'porte' && <>
      <path d="M11 39V23c0-10 6-16 13-16s13 6 13 16v16" stroke="#17233F" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M5 27c10-10 28-10 38 0M5 27c9 9 29 9 38 0" stroke="#B49450" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M20 33v-7a4 4 0 0 1 8 0v7" fill="#F4E4BB" stroke="#B49450" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M18 40h12" stroke="#B49450" strokeWidth="1.5" strokeLinecap="round"/>
    </>}
    {variant === 'lueur' && <>
      <path d="M5 28c9-11 29-12 38 0" stroke="#B49450" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M5 28c4 5 8 7 13 8M43 28c-4 5-8 7-13 8" stroke="#17233F" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="24" cy="27" r="6" fill="#17233F"/>
      <path d="m24 22 1.4 3.6 3.6 1.4-3.6 1.4L24 32l-1.4-3.6L19 27l3.6-1.4Z" fill="#E2C785"/>
      <path d="M24 9v5M13 13l2.5 4M35 13l-2.5 4" stroke="#B49450" strokeWidth="1.5" strokeLinecap="round"/>
    </>}
  </svg>
}

// Sélecteur artistique local, affiché uniquement dans la messagerie de démonstration.
export default function ArcheLogoPreview() {
  const [selected, setSelected] = useState('regard')
  const proposal = PROPOSALS.find(item => item.id === selected)
  return <div className="arche-logo-preview" data-logo-proposal={selected}>
    <details onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus() } }}>
      <summary aria-label="Comparer les propositions du logo L’ARCHE" title={'Logo '+proposal.name+' · comparer les propositions'}>
        <ArcheLogoSymbol variant={selected}/><strong>L’ARCHE</strong>
      </summary>
      <div className="arche-logo-choices">
        <p>L’Arche · filiation MediumIA</p>
        {PROPOSALS.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={event => { setSelected(item.id); const details = event.currentTarget.closest('details'); details.open = false; details.querySelector('summary').focus() }}>
          <ArcheLogoSymbol variant={item.id}/><span><strong>{item.name}</strong><span>{item.description}</span></span>
        </button>)}
      </div>
    </details>
    <span className="arche-logo-demo">Démo</span>
  </div>
}
