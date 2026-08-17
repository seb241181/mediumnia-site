import FormationHero from './FormationHero'
import FormationAudience from './FormationAudience'
import FormationJourney from './FormationJourney'
import FormationContents from './FormationContents'
import FormationLevels from './FormationLevels'
import FormationFounder from './FormationFounder'
import FormationTestimonials from './FormationTestimonials'
import FormationOffer from './FormationOffer'
import FormationFAQ from './FormationFAQ'
import {
  formationHero,
  formationAudience,
  formationDifference,
  formationJourney,
  formationContents,
  formationLevels,
  formationApproach,
  formationFounder,
  formationTestimonials,
  formationOffer,
  formationFaq,
} from '../../data/formationContent'
import '../../styles/formation.css'

export default function FormationPage({
  onPurchaseRequest,
  onTrialRequest,
  onBookingRequest,
  actionsEnabled = false,
}) {
  return (
    <div className="formation-module">
      <FormationHero content={formationHero} onTrialRequest={onTrialRequest} actionsEnabled={actionsEnabled} />
      <main>
        <FormationAudience content={formationAudience} />
        <FormationJourney difference={formationDifference} journey={formationJourney} approach={formationApproach} />
        <FormationContents contents={formationContents} />
        <FormationLevels levels={formationLevels} />
        <FormationFounder founder={formationFounder} onBookingRequest={onBookingRequest} actionsEnabled={actionsEnabled} />
        <FormationTestimonials testimonials={formationTestimonials} />
        <FormationOffer offer={formationOffer} onPurchaseRequest={onPurchaseRequest} actionsEnabled={actionsEnabled} />
        <FormationFAQ items={formationFaq} />
      </main>
    </div>
  )
}
