export default function FormationOffer({ offer, onPurchaseRequest, actionsEnabled = false }) {
  const purchaseEnabled = actionsEnabled && typeof onPurchaseRequest === 'function'

  return (
    <section className="formation-offer" aria-labelledby="formation-offer-title">
      <div className="formation-section">
        <p className="formation-eyebrow">Le parcours complet</p>
        <h2 id="formation-offer-title">{offer.title}</h2>
        <div className="formation-offer__card">
          <p className="formation-offer__status">{offer.status}</p>
          <ul>{offer.includes.map((item) => <li key={item}><span aria-hidden="true">—</span>{item}</li>)}</ul>
          <div className="formation-offer__historical">
            <small>Tarif affiché sur l’ancien site</small><strong>{offer.historicalPrice}</strong><p>{offer.historicalPaymentNote}</p>
          </div>
          <button type="button" disabled={!purchaseEnabled} onClick={() => purchaseEnabled && onPurchaseRequest(offer)}>
            Commencer le parcours <span>· bientôt</span>
          </button>
          <p className="formation-safety">{offer.safetyNote}</p>
        </div>
      </div>
    </section>
  )
}
