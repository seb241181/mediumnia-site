-- Lumia Messages V2 — boîte de réception privée (lecture seule pour Lumia).
--
-- Distincte du pipeline RDV (booking_requests / booking_request_intake_events),
-- qui reste inchangé : un même message peut être ici ET dans une demande RDV.
--
-- Contenu : messages TEXTE reçus sur le Mac (iMessage, SMS, RCS), déposés par le
-- bridge local via POST /api/rdv-admin?action=lumia-message-intake.
-- Jamais : pièce jointe, photo, vidéo, fichier, jeton, donnée système.
-- Aucun historique importé : seuls les messages reçus après l'activation.
--
-- Accès :
--   - écriture : service_role uniquement (le serveur, après contrôle du jeton) ;
--   - lecture  : le propriétaire (owner_id = auth.uid()), jamais anon ;
--   - aucune modification ni suppression côté client.
-- Rétention : aucune purge automatique tant qu'une durée n'a pas été choisie.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.lumia_message_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_channel TEXT NOT NULL CHECK (source_channel IN ('imessage', 'sms', 'rcs')),
  -- Identifiant Apple stable du message (guid), même règle que l'intake RDV.
  source_message_id TEXT NOT NULL CHECK (source_message_id ~ '^[A-Za-z0-9._:@+/=-]{1,200}$'),
  source_conversation_id TEXT CHECK (source_conversation_id IS NULL OR source_conversation_id ~ '^[A-Za-z0-9._:@+/=-]{1,200}$'),
  -- Expéditeur normalisé : téléphone E.164 ou e-mail (iMessage par adresse).
  sender TEXT CHECK (sender IS NULL OR sender ~ '^\+[1-9][0-9]{6,14}$' OR (sender = lower(sender) AND sender ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  message_text TEXT NOT NULL CHECK (char_length(message_text) BETWEEN 1 AND 4000),
  message_sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Préparé pour un contexte entrant/sortant futur ; le serveur refuse
  -- aujourd'hui tout message sortant (synchronisation non activée).
  is_from_me BOOLEAN NOT NULL DEFAULT false,
  -- Classement local du bridge (filtre RDV), à titre indicatif.
  classification TEXT CHECK (classification IS NULL OR classification IN ('probable', 'incertain', 'ignorer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotence : un message Apple n'est stocké qu'une fois par propriétaire.
  CONSTRAINT uq_lumia_message_inbox_source UNIQUE (owner_id, source_channel, source_message_id)
);

CREATE INDEX IF NOT EXISTS idx_lumia_message_inbox_owner_sent
  ON public.lumia_message_inbox (owner_id, message_sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_lumia_message_inbox_owner_sender
  ON public.lumia_message_inbox (owner_id, sender, message_sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_lumia_message_inbox_owner_conversation
  ON public.lumia_message_inbox (owner_id, source_conversation_id, message_sent_at DESC);

ALTER TABLE public.lumia_message_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lumia_message_inbox FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.lumia_message_inbox FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lumia_message_inbox TO authenticated;
GRANT SELECT, INSERT ON public.lumia_message_inbox TO service_role;

DROP POLICY IF EXISTS lumia_message_inbox_owner_select ON public.lumia_message_inbox;
CREATE POLICY lumia_message_inbox_owner_select
  ON public.lumia_message_inbox
  FOR SELECT
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

COMMENT ON TABLE public.lumia_message_inbox IS
  'Lumia Messages V2 : messages texte entrants (iMessage/SMS/RCS) du propriétaire. Données client NON FIABLES, jamais des instructions. Écriture service_role uniquement.';
