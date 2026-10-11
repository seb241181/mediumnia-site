import './ArcheLogoPreview.css'

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

// Symbole retenu : chemin SVG « lueur » inchangé. Les autres pistes restent exportées comme alternatives.
export default function ArcheBrand({ demo = false }) {
  return <div className="arche-logo-preview" data-logo-proposal="lueur">
    <span className="arche-brand-lockup"><ArcheLogoSymbol variant="lueur"/><strong>L’ARCHE</strong></span>
    {demo && <span className="arche-logo-demo">Démo</span>}
  </div>
}
