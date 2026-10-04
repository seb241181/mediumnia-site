-- Lumia Messages — messages SORTANTS en lecture seule dans la boîte de réception.
--
-- But : comprendre une conversation complète et savoir si Sébastien a déjà
-- répondu. Aucune capacité d'envoi : la table ne fait que stocker ce que le
-- bridge a LU dans chat.db.
--
-- counterpart = l'interlocuteur, dans les deux sens :
--   entrant : sender = expéditeur, counterpart = expéditeur ;
--   sortant : sender = NULL (c'est Sébastien), counterpart = destinataire.
-- Le même source_conversation_id réunit les deux sens.
--
-- Garde-fous en base : un message sortant n'a jamais d'expéditeur tiers ni de
-- classement RDV (classification NULL). Les lignes existantes (toutes
-- entrantes) reçoivent counterpart = sender.
--
-- Rétention inchangée (purge à 90 jours sur received_at). Idempotente.

ALTER TABLE public.lumia_message_inbox ADD COLUMN IF NOT EXISTS counterpart TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lumia_message_inbox_counterpart_format') THEN
    ALTER TABLE public.lumia_message_inbox ADD CONSTRAINT lumia_message_inbox_counterpart_format CHECK (
      counterpart IS NULL OR counterpart ~ '^\+[1-9][0-9]{6,14}$'
      OR (counterpart = lower(counterpart) AND counterpart ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lumia_message_inbox_outgoing_shape') THEN
    ALTER TABLE public.lumia_message_inbox ADD CONSTRAINT lumia_message_inbox_outgoing_shape CHECK (
      NOT is_from_me OR (sender IS NULL AND classification IS NULL AND counterpart IS NOT NULL));
  END IF;
END;
$$;

UPDATE public.lumia_message_inbox
SET counterpart = sender
WHERE counterpart IS NULL AND is_from_me = false AND sender IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lumia_message_inbox_owner_counterpart
  ON public.lumia_message_inbox (owner_id, counterpart, message_sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_lumia_message_inbox_owner_conversation_direction
  ON public.lumia_message_inbox (owner_id, source_conversation_id, is_from_me, message_sent_at);

COMMENT ON COLUMN public.lumia_message_inbox.counterpart IS
  'Interlocuteur (entrant : expéditeur ; sortant : destinataire). Téléphone E.164 ou e-mail.';
