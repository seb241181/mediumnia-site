export default function FormationAudience({ content }) {
  return (
    <section className="formation-section formation-audience" aria-labelledby="formation-audience-title">
      <p className="formation-eyebrow">Avant de parler de méthode, parlons de vous</p>
      <h2 id="formation-audience-title">{content.title}</h2>
      <div className="formation-audience__situations">
        {content.situations.map((situation) => <p key={situation}><span aria-hidden="true">✦</span>{situation}</p>)}
      </div>
      <blockquote>{content.conclusion}</blockquote>
    </section>
  )
}
