export default function FormationHero({ content, onTrialRequest, actionsEnabled = false }) {
  const trialEnabled = actionsEnabled && typeof onTrialRequest === 'function'

  return (
    <header className="formation-hero">
      <span className="formation-hero__symbol" aria-hidden="true">✦</span>
      <p className="formation-eyebrow">{content.eyebrow}</p>
      <h1>{content.title}</h1>
      <p className="formation-hero__promise">{content.lines.map((line) => <span key={line}>{line}<br /></span>)}</p>
      <p className="formation-hero__intro">{content.introduction}</p>
      <div className="formation-hero__actions">
        <a href="#formation-parcours">Découvrir le parcours</a>
        <button type="button" disabled={!trialEnabled} onClick={() => trialEnabled && onTrialRequest()}>
          Essayer MediumIA <span>· bientôt</span>
        </button>
      </div>
      <p className="formation-safety">Aucun formulaire ni code d’essai actif dans cette maquette.</p>
    </header>
  )
}
