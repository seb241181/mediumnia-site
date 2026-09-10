import FounderCopilotAccess from './FounderCopilotAccess.jsx'
import ProWaitlistPublic from './ProWaitlistPublic.jsx'

export default function ProWaitlistPage(props) {
  const isFounderPilot = window.location.pathname.startsWith('/agents')

  if (isFounderPilot) {
    return <FounderCopilotAccess onBack={props.onBack} />
  }

  return <ProWaitlistPublic {...props} />
}
