export default function FormationFounder({ founder, onBookingRequest, actionsEnabled = false }) {
  const bookingEnabled = actionsEnabled && typeof onBookingRequest === 'function'

  return (
    <section className="formation-section formation-founder" aria-labelledby="formation-founder-title">
      <p className="formation-eyebrow">Une transmission issue du réel</p>
      <h2 id="formation-founder-title">Qui vous transmet ce parcours</h2>
      <div className="formation-founder__layout">
        <aside>
          <img src={founder.portrait} alt={founder.portraitAlt} />
          <h3>{founder.name}</h3><p>{founder.role}</p>
          <button type="button" disabled={!bookingEnabled} onClick={() => bookingEnabled && onBookingRequest(founder)}>
            Prendre rendez-vous <span>· bientôt</span>
          </button>
        </aside>
        <div className="formation-founder__story">
          {founder.paragraphs.map((paragraph, index) => <p key={paragraph} className={index === 6 ? 'is-emphasis' : ''}>{paragraph}</p>)}
          <blockquote>« {founder.quote} »</blockquote>
        </div>
      </div>
    </section>
  )
}
