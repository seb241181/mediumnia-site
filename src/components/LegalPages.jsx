import { useState } from 'react'
import LegalFooter from './LegalFooter'

function LegalShell({ onBack, onNavigate, title, children }) {
  return (
    <div className="bg-cream min-h-screen text-deep">
      <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">← MediumIA</button>
          <span className="font-georgia text-deep tracking-[0.12em] text-sm font-semibold hidden md:block">{title}</span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <h1 className="font-georgia text-2xl md:text-3xl font-medium text-deep mb-10">{title}</h1>
        <div className="space-y-8">{children}</div>
      </main>
      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="font-georgia font-medium text-deep text-base mb-2">{title}</h2>
      <div className="font-georgia text-sm text-mist leading-relaxed space-y-2">{children}</div>
    </div>
  )
}

/* ─────────────────────────────────────
   MENTIONS LÉGALES
   ───────────────────────────────────── */
export function MentionsLegales({ onBack, onNavigate }) {
  return (
    <LegalShell onBack={onBack} onNavigate={onNavigate} title="Mentions légales">

      <Section title="Éditeur du site">
        <p>
          Sébastien Seguin, entrepreneur individuel<br />
          Nom commercial : MediumIA<br />
          SIRET : 81918584400027<br />
          1 Chemin des Capucines, 59143 Lederzeele<br />
          Email : <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a><br />
          Téléphone : 06 29 97 38 78
        </p>
        <p>Responsable de la publication : Sébastien Seguin.</p>
      </Section>

      <Section title="Hébergement">
        <p>Vercel Inc. — 340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis — <a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">vercel.com</a></p>
      </Section>

      <Section title="Nature des contenus">
        <p>
          MediumIA propose des contenus liés à l'accompagnement personnel, à l'introspection et à l'information dans le domaine de la médiumnité et du bien-être.
          Ces contenus ne constituent en aucun cas un avis médical, psychologique, juridique ou financier.
          Ils ne remplacent pas l'avis d'un professionnel de santé ou de tout autre professionnel qualifié.
        </p>
        <p>
          L'Oracle Au-delà de l'Âme est un outil d'accompagnement personnel et d'introspection.
          Les tirages et interprétations ne constituent pas des prédictions et ne garantissent aucun résultat.
        </p>
      </Section>

      <Section title="Responsabilité">
        <p>
          La pratique de la médiumnité relève d'une démarche personnelle et volontaire.
          Sébastien Seguin ne saurait être tenu responsable de l'usage que l'utilisateur fait des contenus, outils et services proposés.
          En cas de troubles psychiques, de détresse émotionnelle ou de tout symptôme nécessitant une prise en charge, l'utilisateur s'engage à consulter un professionnel de santé qualifié.
        </p>
      </Section>

      <Section title="Propriété intellectuelle">
        <p>
          L'ensemble du contenu du site MediumIA (textes, images, illustrations, structure, méthodologie, application, oracle)
          est la propriété intellectuelle de Sébastien Seguin, sauf mention contraire.
          Toute reproduction, partielle ou totale, est interdite sans autorisation écrite préalable.
        </p>
      </Section>

      <Section title="Médiation de la consommation">
        <p>
          Conformément aux articles L. 612-1 et suivants du Code de la consommation,
          en cas de litige non résolu après réclamation préalable auprès du professionnel,
          le consommateur peut recourir gratuitement au médiateur de la consommation désigné :
        </p>
        <p>
          CM2C — Centre de la Médiation de la Consommation de Conciliateurs de Justice<br />
          49 rue de Ponthieu, 75008 Paris<br />
          <a href="mailto:contact@cm2c.net" className="text-gold hover:underline">contact@cm2c.net</a> — 01 89 47 00 14<br />
          <a href="https://www.cm2c.net" target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">www.cm2c.net</a>
        </p>
      </Section>

    </LegalShell>
  )
}

/* ─────────────────────────────────────
   POLITIQUE DE CONFIDENTIALITÉ
   ───────────────────────────────────── */
export function PolitiqueConfidentialite({ onBack, onNavigate }) {
  return (
    <LegalShell onBack={onBack} onNavigate={onNavigate} title="Politique de confidentialité">

      <Section title="Responsable du traitement">
        <p>
          Le responsable du traitement des données personnelles est Sébastien Seguin, entrepreneur individuel (SIRET : 81918584400027).
          Pour toute question relative à vos données : <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a>.
        </p>
      </Section>

      <Section title="Données collectées — Rendez-vous">
        <p>
          Lors d'une demande de rendez-vous, les données suivantes peuvent être collectées :
          prénom, nom, email, téléphone, message, adresse / code postal / ville (en cas de déplacement), créneau souhaité.
        </p>
        <p>Finalité : gestion de la demande et du rendez-vous. Base légale : mesures précontractuelles et exécution contractuelle.</p>
      </Section>

      <Section title="Données collectées — Oracle (achat)">
        <p>
          L'achat de l'Oracle est traité par PayPal. Nous n'avons pas accès à vos données bancaires.
          Les données de commande (nom, email, adresse de livraison) sont utilisées pour le traitement et l'expédition.
        </p>
      </Section>

      <Section title="Données collectées — Rétractation">
        <p>
          Lors d'une demande de rétractation en ligne, les données suivantes sont collectées :
          prénom, nom, email, email utilisé lors de l'achat, référence de commande, date d'achat.
          La date et l'heure de réception de la demande sont horodatées côté serveur.
        </p>
        <p>
          Finalité : traitement de la demande de rétractation et envoi de l'accusé de réception via Resend.
          Ces données ne sont pas stockées en base de données.
        </p>
      </Section>

      <Section title="Données collectées — Oracle (tirage gratuit)">
        <p>
          Le tirage test gratuit collecte votre adresse email. Côté serveur, un hash de cette adresse est conservé dans Supabase
          pour appliquer la règle d'un seul tirage gratuit par personne. L'email brut est utilisé transitoirement pour l'envoi
          de l'interprétation via Resend, puis n'est pas conservé en clair au-delà du traitement.
          Les cartes tirées, l'interprétation et le statut du tirage sont enregistrés dans Supabase.
          L'interprétation est générée par OpenAI.
        </p>
      </Section>

      <Section title="Données collectées — Essai MediumIA">
        <p>
          Les messages échangés lors d'un essai sont transmis à Anthropic pour générer la réponse.
          Aucune conversation d'essai n'est stockée de manière persistante côté serveur dans MediumIA.
        </p>
      </Section>

      <Section title="Données collectées — Agents MediumIA (espace Pro)">
        <p>
          L'espace Pro permet de créer des agents IA. Les données suivantes sont stockées dans Supabase :
          compte utilisateur, conversations, messages, documents et sources transmises.
          Les messages sont envoyés à Anthropic ou OpenAI selon le fournisseur choisi par le propriétaire de l'agent.
        </p>
      </Section>

      <Section title="Mécanisme anti-abus (rate limiting)">
        <p>
          Pour protéger le service, l'adresse IP est pseudonymisée via un mécanisme HMAC-SHA256 avant tout enregistrement.
          L'adresse IP brute n'est jamais stockée dans les tables de la base de données.
          Les entrées de comptage datant de plus de 48 heures sont supprimées lors des opérations de nettoyage du mécanisme.
        </p>
      </Section>

      <Section title="Prestataires techniques">
        <p>Les prestataires suivants interviennent dans le traitement de vos données :</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Vercel Inc. — hébergement du site et des fonctions serveur</li>
          <li>Supabase — base de données et authentification</li>
          <li>Resend — emails transactionnels</li>
          <li>Google (Google Calendar) — synchronisation des rendez-vous</li>
          <li>Anthropic — intelligence artificielle (certaines fonctions)</li>
          <li>OpenAI — intelligence artificielle (certaines fonctions)</li>
          <li>PayPal — paiement sécurisé de l'Oracle</li>
        </ul>
      </Section>

      <Section title="Conservation des données">
        <p>
          Les données sont conservées pour la durée nécessaire aux finalités décrites ci-dessus
          et conformément aux obligations légales applicables (notamment la conservation des données de facturation).
        </p>
      </Section>

      <Section title="Vos droits">
        <p>
          Conformément au Règlement Général sur la Protection des Données (UE 2016/679), vous disposez des droits suivants
          concernant vos données personnelles : accès, rectification, effacement, limitation du traitement, opposition et portabilité lorsque applicable.
        </p>
        <p>
          Pour exercer ces droits : <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a>.
        </p>
        <p>
          En cas de réponse insatisfaisante, vous pouvez introduire une réclamation auprès de la CNIL (<a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">www.cnil.fr</a>).
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          Le site MediumIA n'utilise pas de cookies de tracking ni de cookies publicitaires.
          Des cookies techniques peuvent être utilisés par les prestataires tiers (PayPal, Supabase) dans le cadre de leurs services.
        </p>
      </Section>

    </LegalShell>
  )
}

/* ─────────────────────────────────────
   CGV — ORACLE AU-DELÀ DE L'ÂME
   ───────────────────────────────────── */
export function CgvOracle({ onBack, onNavigate }) {
  return (
    <LegalShell onBack={onBack} onNavigate={onNavigate} title="Conditions générales de vente — Oracle Au-delà de l'Âme">

      <Section title="1. Vendeur">
        <p>
          Sébastien Seguin, entrepreneur individuel<br />
          Nom commercial : MediumIA<br />
          SIRET : 81918584400027<br />
          1 Chemin des Capucines, 59143 Lederzeele<br />
          Email : <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a><br />
          Téléphone : 06 29 97 38 78
        </p>
      </Section>

      <Section title="2. Objet">
        <p>
          Les présentes Conditions Générales de Vente régissent la vente à distance de l'Oracle Au-delà de l'Âme,
          produit physique proposé sur le site mediumia.fr.
        </p>
      </Section>

      <Section title="3. Produit">
        <p>
          Oracle Au-delà de l'Âme — Jeu de 45 Cartes d'Éveil Intuitif.<br />
          Format : 7 × 12 cm — Papier 350 g haute qualité — Impression recto-verso brillante — Illustrations haute résolution.<br />
          Chaque carte comporte une phrase d'activation et un QR code donnant accès à Lumïa (guide IA intégrée) et à des méditations.<br />
          Création originale française de Sébastien Seguin.
        </p>
      </Section>

      <Section title="4. Prix">
        <p>
          Prix de l'Oracle : 29,90 € TTC<br />
          Frais de livraison (France métropolitaine) : 4,79 €<br />
          <strong className="text-deep">Total : 34,69 € TTC livraison comprise en France métropolitaine</strong>
        </p>
      </Section>

      <Section title="5. Commande">
        <p>
          La commande est passée via le bouton de paiement sur le site mediumia.fr.
          Le client est redirigé vers PayPal pour procéder au paiement.
          La commande est confirmée dès réception du paiement.
        </p>
      </Section>

      <Section title="6. Paiement">
        <p>
          Le paiement est effectué en ligne via PayPal (PayPal (Europe) S.à r.l. et Cie, S.C.A.).
          Le vendeur n'a pas accès aux données bancaires du client.
        </p>
      </Section>

      <Section title="7. Livraison">
        <p>
          Expédition sous 5 jours ouvrés après réception du paiement.<br />
          Livraison en France métropolitaine.<br />
          Sauf délai différent indiqué au consommateur lors de la commande, le bien est livré sans retard injustifié et au plus tard trente jours après la conclusion du contrat.<br />
          Les délais de livraison dépendent du transporteur et ne sont donnés qu'à titre indicatif.
        </p>
      </Section>

      <Section title="8. Droit de rétractation">
        <p>
          Conformément aux articles L. 221-18 et suivants du Code de la consommation,
          le client dispose d'un délai de 14 jours à compter de la réception du produit
          pour exercer son droit de rétractation, sans avoir à justifier de motifs ni à payer de pénalités,
          sous réserve des exceptions prévues par la loi.
        </p>
        <p>
          Pour exercer ce droit, le client peut utiliser le <a href="/retractation" onClick={(e) => { e.preventDefault(); onNavigate('/retractation') }} className="text-gold hover:underline">formulaire de rétractation</a> ou
          contacter le vendeur à <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a>.
        </p>
      </Section>

      <Section title="9. Modalités de retour">
        <p>
          Le consommateur doit retourner le bien dans les quatorze jours suivant la communication de sa décision de se rétracter.
          Sa responsabilité ne peut être engagée qu'en cas de dépréciation du bien résultant de manipulations autres que celles nécessaires pour en établir la nature, les caractéristiques et le bon fonctionnement.
        </p>
        <p>
          Les frais directs de retour sont à la charge du consommateur, sauf en cas de produit défectueux ou non conforme, ou disposition légale contraire.
        </p>
        <p>
          Adresse de retour :<br />
          Sébastien Seguin<br />
          1 Chemin des Capucines<br />
          59143 Lederzeele
        </p>
      </Section>

      <Section title="10. Remboursement">
        <p>
          En cas de rétractation, Sébastien Seguin rembourse les sommes versées, y compris les frais de livraison standard initiaux,
          sans retard injustifié et au plus tard dans les quatorze jours à compter de la date à laquelle il est informé de la décision de rétractation.
        </p>
        <p>
          Pour la vente de l'Oracle, le remboursement peut être différé jusqu'à récupération du bien ou jusqu'à réception d'une preuve de son expédition,
          la date retenue étant celle du premier de ces faits.
        </p>
        <p>
          Le remboursement est effectué avec le même moyen de paiement que celui utilisé pour la transaction initiale,
          sauf accord exprès du consommateur et sans frais pour celui-ci.
        </p>
      </Section>

      <Section title="11. Garanties légales">
        <p>
          Le produit bénéficie de la garantie légale de conformité (articles L. 217-3 et suivants du Code de la consommation)
          et de la garantie des vices cachés (articles 1641 et suivants du Code civil).
        </p>
      </Section>

      <Section title="12. Responsabilité">
        <p>
          L'Oracle Au-delà de l'Âme est un outil d'accompagnement personnel et d'introspection.
          Les tirages et interprétations ne constituent pas des prédictions et ne garantissent aucun résultat.
          Ils ne remplacent pas l'avis d'un professionnel de santé, juridique ou financier.
        </p>
      </Section>

      <Section title="13. Données personnelles">
        <p>
          Les données collectées lors de la commande sont traitées conformément à notre <a href="/confidentialite" onClick={(e) => { e.preventDefault(); onNavigate('/confidentialite') }} className="text-gold hover:underline">politique de confidentialité</a>.
        </p>
      </Section>

      <Section title="14. Médiation">
        <p>
          En cas de litige non résolu après réclamation préalable auprès du vendeur (<a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a>),
          le consommateur peut recourir gratuitement au médiateur de la consommation :
        </p>
        <p>
          CM2C — Centre de la Médiation de la Consommation de Conciliateurs de Justice<br />
          49 rue de Ponthieu, 75008 Paris<br />
          <a href="mailto:contact@cm2c.net" className="text-gold hover:underline">contact@cm2c.net</a> — 01 89 47 00 14<br />
          <a href="https://www.cm2c.net" target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">www.cm2c.net</a>
        </p>
      </Section>

      <Section title="15. Droit applicable">
        <p>Les présentes CGV sont soumises au droit français. En cas de litige, les tribunaux français sont compétents.</p>
      </Section>

      <div className="border-t border-gold/20 pt-8 mt-4">
        <h2 className="font-georgia font-medium text-deep text-base mb-4">Modèle de formulaire de rétractation</h2>
        <div className="font-georgia text-sm text-mist leading-relaxed bg-white/60 border border-gold/20 rounded-xl p-6 space-y-3">
          <p className="italic text-mist/70">(À remplir et à renvoyer uniquement si vous souhaitez exercer votre droit de rétractation)</p>
          <p>À l'attention de : Sébastien Seguin — <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a></p>
          <p>Je notifie par la présente ma rétractation du contrat portant sur la vente du bien ci-dessous :</p>
          <p>Produit : Oracle Au-delà de l'Âme</p>
          <p>Commandé le : _______________</p>
          <p>Reçu le : _______________</p>
          <p>Nom du consommateur : _______________</p>
          <p>Adresse du consommateur : _______________</p>
          <p>Date : _______________</p>
          <p>Signature (en cas de formulaire papier) : _______________</p>
        </div>
      </div>

    </LegalShell>
  )
}

/* ─────────────────────────────────────
   RÉTRACTATION (page fonctionnelle)
   ───────────────────────────────────── */
export function Retractation({ onBack, onNavigate }) {
  const [form, setForm] = useState({
    prenom: '', nom: '', email: '', emailAchat: '',
    reference: '', dateAchat: '',
  })
  const [errors, setErrors] = useState({})
  const [step, setStep] = useState('form')
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const inputCls = "w-full font-georgia text-sm text-deep bg-white border border-gold/30 rounded-xl px-4 py-3 focus:outline-none focus:border-gold/70 transition-colors placeholder:text-mist/40"
  const labelCls = "block font-georgia text-xs tracking-[0.15em] uppercase text-mist mb-2"

  function validate() {
    const e = {}
    if (!form.prenom.trim()) e.prenom = 'Requis'
    if (!form.nom.trim()) e.nom = 'Requis'
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Email invalide'
    if (!form.emailAchat.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.emailAchat)) e.emailAchat = 'Email invalide'
    if (!form.reference.trim()) e.reference = 'Requis'
    if (!form.dateAchat.trim()) e.dateAchat = 'Requis'
    return e
  }

  function handleReview(ev) {
    ev.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setStep('review')
    window.scrollTo(0, 0)
  }

  async function handleConfirm() {
    setLoading(true)
    setApiError('')
    try {
      const res = await fetch('/api/retractation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setApiError(data.error || 'Une erreur est survenue. Veuillez réessayer.')
        setLoading(false)
        return
      }
      setStep('done')
      window.scrollTo(0, 0)
    } catch {
      setApiError('Impossible de contacter le serveur. Veuillez réessayer.')
      setLoading(false)
    }
  }

  if (step === 'done') {
    return (
      <LegalShell onBack={onBack} onNavigate={onNavigate} title="Droit de rétractation">
        <div className="text-center py-8">
          <p className="text-gold text-4xl mb-6">✦</p>
          <p className="font-georgia text-gold tracking-[0.2em] text-xs uppercase mb-4">Demande transmise</p>
          <h2 className="font-georgia font-medium text-2xl text-deep mb-6">
            Votre demande de rétractation a bien été transmise.
          </h2>
          <p className="font-georgia text-mist leading-relaxed mb-8">
            Un accusé de réception vient de vous être envoyé par email.
          </p>
          <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">
            ← Retour à MediumIA
          </button>
        </div>
      </LegalShell>
    )
  }

  if (step === 'review') {
    return (
      <LegalShell onBack={onBack} onNavigate={onNavigate} title="Droit de rétractation">
        <Section title="Récapitulatif de votre demande">
          <div className="bg-white/60 border border-gold/20 rounded-xl p-6 space-y-3">
            <p><strong className="text-deep">Produit :</strong> Oracle Au-delà de l'Âme</p>
            <p><strong className="text-deep">Prénom :</strong> {form.prenom}</p>
            <p><strong className="text-deep">Nom :</strong> {form.nom}</p>
            <p><strong className="text-deep">Email pour l'accusé :</strong> {form.email}</p>
            <p><strong className="text-deep">Email utilisé lors de l'achat :</strong> {form.emailAchat}</p>
            <p><strong className="text-deep">Référence de commande / transaction :</strong> {form.reference}</p>
            <p><strong className="text-deep">Date d'achat :</strong> {form.dateAchat}</p>
          </div>
          <p className="italic mt-4">
            Je vous informe de ma décision de me rétracter du contrat portant sur l'Oracle Au-delà de l'Âme identifié par les informations ci-dessus.
          </p>
        </Section>
        {apiError && (
          <p className="font-georgia text-sm text-red-500">{apiError}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            type="button"
            onClick={() => { setStep('form'); setApiError('') }}
            className="font-georgia text-sm text-mist hover:text-deep transition-colors py-3 px-6"
          >
            ← Modifier
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 font-georgia py-4 px-8 rounded-xl bg-deep text-gold font-bold text-base hover:bg-deep/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <div className="w-4 h-4 border border-gold/40 border-t-gold rounded-full animate-spin" />}
            {loading ? 'Envoi en cours…' : 'Confirmer la rétractation'}
          </button>
        </div>
      </LegalShell>
    )
  }

  return (
    <LegalShell onBack={onBack} onNavigate={onNavigate} title="Droit de rétractation">

      <Section title="Votre droit de rétractation">
        <p>
          Conformément aux articles L. 221-18 et suivants du Code de la consommation,
          vous disposez d'un délai de 14 jours à compter de la réception de votre commande
          pour exercer votre droit de rétractation, sans avoir à justifier de motifs ni à payer de pénalités,
          sous réserve des exceptions prévues par la loi.
        </p>
      </Section>

      <Section title="Autres moyens d'exercer votre droit">
        <p>
          Vous pouvez également nous contacter par email
          à <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a>,
          par téléphone au 06 29 97 38 78, ou par courrier à l'adresse :
          Sébastien Seguin, 1 Chemin des Capucines, 59143 Lederzeele.
        </p>
        <p>
          Le modèle de formulaire de rétractation figure également dans
          nos <a href="/cgv-oracle" onClick={(e) => { e.preventDefault(); onNavigate('/cgv-oracle') }} className="text-gold hover:underline">Conditions Générales de Vente</a>.
        </p>
      </Section>

      <div className="border-t border-gold/20 pt-8 mt-4">
        <h2 className="font-georgia font-medium text-deep text-lg mb-2">Renoncer au contrat ici</h2>
        <p className="font-georgia text-sm text-mist leading-relaxed mb-6">
          Remplissez le formulaire ci-dessous pour notifier votre rétractation en ligne.
        </p>

        <form onSubmit={handleReview} noValidate className="space-y-5">
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <label className={labelCls}>Prénom <span className="text-gold">*</span></label>
              <input type="text" value={form.prenom} onChange={e => set('prenom', e.target.value)} className={inputCls} placeholder="Marie" />
              {errors.prenom && <p className="font-georgia text-xs text-red-500 mt-1">{errors.prenom}</p>}
            </div>
            <div>
              <label className={labelCls}>Nom <span className="text-gold">*</span></label>
              <input type="text" value={form.nom} onChange={e => set('nom', e.target.value)} className={inputCls} placeholder="Dupont" />
              {errors.nom && <p className="font-georgia text-xs text-red-500 mt-1">{errors.nom}</p>}
            </div>
          </div>

          <div>
            <label className={labelCls}>Email pour recevoir l'accusé <span className="text-gold">*</span></label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} placeholder="vous@exemple.fr" />
            {errors.email && <p className="font-georgia text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>

          <div>
            <label className={labelCls}>Email utilisé lors de l'achat <span className="text-gold">*</span></label>
            <input type="email" value={form.emailAchat} onChange={e => set('emailAchat', e.target.value)} className={inputCls} placeholder="achat@exemple.fr" />
            {errors.emailAchat && <p className="font-georgia text-xs text-red-500 mt-1">{errors.emailAchat}</p>}
          </div>

          <div>
            <label className={labelCls}>Référence de commande / transaction PayPal <span className="text-gold">*</span></label>
            <input type="text" value={form.reference} onChange={e => set('reference', e.target.value)} className={inputCls} placeholder="Ex : 5GH12345AB678901C" />
            {errors.reference && <p className="font-georgia text-xs text-red-500 mt-1">{errors.reference}</p>}
          </div>

          <div>
            <label className={labelCls}>Date d'achat <span className="text-gold">*</span></label>
            <input type="date" value={form.dateAchat} onChange={e => set('dateAchat', e.target.value)} className={inputCls} />
            {errors.dateAchat && <p className="font-georgia text-xs text-red-500 mt-1">{errors.dateAchat}</p>}
          </div>

          <div>
            <label className={labelCls}>Produit</label>
            <input type="text" value="Oracle Au-delà de l'Âme" disabled className={`${inputCls} bg-cream/80 text-mist cursor-not-allowed`} />
          </div>

          <button
            type="submit"
            className="w-full font-georgia py-4 px-8 rounded-xl bg-deep text-gold font-bold text-base hover:bg-deep/90 transition-colors"
          >
            Vérifier et continuer →
          </button>
        </form>
      </div>

      <Section title="Retour du produit">
        <p>
          Le consommateur doit retourner le bien dans les quatorze jours suivant la communication de sa décision de se rétracter.
          Sa responsabilité ne peut être engagée qu'en cas de dépréciation du bien résultant de manipulations autres que celles nécessaires pour en établir la nature, les caractéristiques et le bon fonctionnement.
        </p>
        <p>
          Les frais directs de retour sont à la charge du consommateur, sauf en cas de produit défectueux ou non conforme, ou disposition légale contraire.
        </p>
        <p>
          Adresse de retour :<br />
          Sébastien Seguin<br />
          1 Chemin des Capucines<br />
          59143 Lederzeele
        </p>
      </Section>

      <Section title="Remboursement">
        <p>
          En cas de rétractation, Sébastien Seguin rembourse les sommes versées, y compris les frais de livraison standard initiaux,
          sans retard injustifié et au plus tard dans les quatorze jours à compter de la date à laquelle il est informé de la décision de rétractation.
        </p>
        <p>
          Pour la vente de l'Oracle, le remboursement peut être différé jusqu'à récupération du bien ou jusqu'à réception d'une preuve de son expédition,
          la date retenue étant celle du premier de ces faits.
        </p>
        <p>
          Le remboursement est effectué avec le même moyen de paiement que celui utilisé pour la transaction initiale,
          sauf accord exprès du consommateur et sans frais pour celui-ci.
        </p>
      </Section>

      <div className="border-t border-gold/20 pt-8 mt-4">
        <p className="font-georgia text-sm text-mist leading-relaxed">
          Pour toute question : <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a> — 06 29 97 38 78
        </p>
      </div>

    </LegalShell>
  )
}
