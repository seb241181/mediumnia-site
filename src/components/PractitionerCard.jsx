function PortraitPlaceholder({ practitioner }) {
  if (practitioner.portrait) {
    return <img src={practitioner.portrait} alt={practitioner.portraitAlt} />
  }

  return (
    <div className="consultation-practitioner__placeholder" role="img" aria-label={practitioner.portraitAlt}>
      <span aria-hidden="true">{practitioner.firstName.charAt(0)}</span>
      <small>Portrait à venir</small>
    </div>
  )
}

export default function PractitionerCard({
  practitioner,
  onOpenRdv,
}) {
  return (
    <article className={`consultation-practitioner consultation-practitioner--${practitioner.accent}`}>
      <div className="consultation-practitioner__portrait">
        <PortraitPlaceholder practitioner={practitioner} />
        <p>{practitioner.intention}</p>
      </div>
      <div className="consultation-practitioner__content">
        <p className="consultation-eyebrow">{practitioner.eyebrow}</p>
        <h3>{practitioner.name}</h3>
        <p className="consultation-practitioner__role">{practitioner.role}</p>
        <p className="consultation-practitioner__intro">{practitioner.introduction}</p>
        {practitioner.statusLabel && (
          <p className="consultation-practitioner__status">{practitioner.statusLabel}</p>
        )}
        {onOpenRdv && practitioner.rdvSlug && (
          <button
            type="button"
            className="consultation-practitioner__book"
            onClick={() => onOpenRdv(practitioner.rdvSlug)}
          >
            Prendre rendez-vous →
          </button>
        )}
      </div>
    </article>
  )
}
