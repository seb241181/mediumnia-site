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
   RÉTRACTATION (page informative)
   ───────────────────────────────────── */
export function Retractation({ onBack, onNavigate }) {
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

      <Section title="Comment exercer votre droit">
        <p>
          Pour exercer votre droit de rétractation, contactez-nous par email
          à <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a>,
          par téléphone au 06 29 97 38 78, ou par courrier à l'adresse :
          Sébastien Seguin, 1 Chemin des Capucines, 59143 Lederzeele, en indiquant :
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Votre nom</li>
          <li>Le produit concerné</li>
          <li>La date de commande et de réception</li>
          <li>Votre souhait de vous rétracter</li>
        </ul>
        <p>
          Vous pouvez également utiliser le modèle de formulaire de rétractation figurant dans
          nos <a href="/cgv-oracle" onClick={(e) => { e.preventDefault(); onNavigate('/cgv-oracle') }} className="text-gold hover:underline">Conditions Générales de Vente</a>.
        </p>
      </Section>

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
