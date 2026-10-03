import AgentChat from '../AgentChat.jsx'
import { useAuth } from '../../lib/useAuth'

const LUMIA_AGENT_ID = 'fcd33963-3e5f-4726-abec-b9c5c5ee4fe2'

export default function LumiaAssistantPage({ onBack }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <main className="min-h-screen bg-cream px-6 py-16">
        <p className="font-georgia text-center text-mist">Ouverture de Lumia…</p>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-cream px-6 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-gold/25 bg-white/60 p-7 text-center">
          <h1 className="font-georgia text-2xl text-deep">Lumia</h1>
          <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">
            Connectez-vous d’abord à votre espace Rendez-vous pour ouvrir votre assistante privée.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-6 rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-semibold text-gold"
          >
            Retour à l’agenda
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-cream pt-8 md:pt-12">
      <AgentChat
        agentId={LUMIA_AGENT_ID}
        onBack={onBack}
        backLabel="Retour à l’agenda"
        documentsEnabled={false}
      />
    </main>
  )
}
