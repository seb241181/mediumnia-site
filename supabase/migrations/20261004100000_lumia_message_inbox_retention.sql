-- Lumia Messages V2 — rétention de la boîte de réception : 90 jours.
--
-- Date de référence : received_at = arrivée du message dans l'Inbox (horloge
-- du serveur, valeur par défaut, jamais fournie par le bridge). message_sent_at
-- vient du téléphone (facultatif) ; created_at est un doublon technique.
--
-- Règle : une ligne est supprimée dès que received_at < now() - 90 jours.
-- Exactement 90 jours : encore conservée (comparaison stricte). La purge
-- tourne une fois par jour : une ligne disparaît donc entre 90 et 91 jours.
--
-- Mécanisme : pg_cron (déjà installé), tâche quotidienne, exécutée par le
-- propriétaire de la table (postgres, BYPASSRLS) via une fonction
-- SECURITY INVOKER sans paramètre. Aucune autre table n'est touchée. Le journal
-- pg_cron ne contient que la commande et un compteur, jamais un message.
--
-- Droits : service_role (serveur) garde uniquement SELECT + INSERT — la purge
-- n'a pas besoin de lui donner DELETE ; UPDATE, DELETE, TRUNCATE, REFERENCES et
-- TRIGGER sont retirés. anon : rien ; authenticated : SELECT de ses lignes (RLS).
--
-- Idempotente.

CREATE INDEX IF NOT EXISTS idx_lumia_message_inbox_received_at
  ON public.lumia_message_inbox (received_at);

REVOKE ALL ON public.lumia_message_inbox FROM service_role;
GRANT SELECT, INSERT ON public.lumia_message_inbox TO service_role;
REVOKE ALL ON public.lumia_message_inbox FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lumia_message_inbox TO authenticated;

CREATE OR REPLACE FUNCTION public.lumia_purge_message_inbox()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.lumia_message_inbox
  WHERE received_at < pg_catalog.now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.lumia_purge_message_inbox() IS
  'Lumia Inbox : supprime les messages reçus il y a plus de 90 jours (received_at). Sans paramètre ; réservé au propriétaire (tâche pg_cron).';

REVOKE ALL ON FUNCTION public.lumia_purge_message_inbox() FROM PUBLIC, anon, authenticated, service_role;

-- Tâche quotidienne (03:17 UTC), recréée à l'identique si elle existe déjà.
DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'lumia-message-inbox-retention' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule('lumia-message-inbox-retention', '17 3 * * *', 'SELECT public.lumia_purge_message_inbox()');
END;
$$;
