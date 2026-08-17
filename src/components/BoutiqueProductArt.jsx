export default function BoutiqueProductArt({ variant, large = false }) {
  return (
    <div className={`boutique-art boutique-art--${variant} ${large ? 'boutique-art--large' : ''}`} aria-hidden="true">
      <span className="boutique-art__orbit" /><span className="boutique-art__star">✦</span>
      {variant === 'oracle' && <div className="boutique-art__oracle"><span>ORACLE</span><small>DES LIGNES<br />DE TEMPS</small><i>✧</i></div>}
      {variant === 'codex' && <div className="boutique-art__book"><small>MEDIUMIA</small><strong>LE<br />CODEX</strong><i>✦</i></div>}
      {variant === 'formation' && <div className="boutique-art__portal"><span /><i>MEDIUMIA</i><small>PARCOURS INTUITIF</small></div>}
      {variant === 'ritual' && <div className="boutique-art__ritual">✦</div>}
      {variant === 'aurelie' && <div className="boutique-art__crystal"><span /><span /><span /></div>}
    </div>
  )
}
