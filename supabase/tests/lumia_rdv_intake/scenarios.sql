\set ON_ERROR_STOP on
set role service_role;
\set P '''aaaaaaaa-0000-0000-0000-000000000001'''
create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'ÉCHEC : %', label; end if; raise notice 'OK  %', label; end $$;
create or replace function pg_temp.intake(p jsonb) returns jsonb language sql as $$
  select public.lumia_upsert_booking_request('aaaaaaaa-0000-0000-0000-000000000001', jsonb_build_object('agent','lumia','channel','sms','detected_at', now()) || p) $$;
create or replace function pg_temp.req(id text) returns public.booking_requests language sql as $$ select * from public.booking_requests where id = id::uuid $$;

\echo '== 1. Demande vague (cas A) =='
select pg_temp.intake('{"message_id":"SMS-1","phone":"06 00 00 00 01","first_name":"Inconnue","message_text":"Bonjour, je voudrais reprendre un rendez-vous avec Sébastien."}') as r1 \gset
select pg_temp.ok('créée', (:'r1'::jsonb->>'outcome') = 'created');
select pg_temp.ok('statut pending, à vérifier, client inconnu', (select status = 'pending' and needs_review and customer_match = 'none' and service_id is null from public.booking_requests where id = (:'r1'::jsonb->>'request_id')::uuid));
select pg_temp.ok('téléphone normalisé, texte conservé', (select customer_phone = '+33600000001' and customer_message like 'Bonjour%' from public.booking_requests where id = (:'r1'::jsonb->>'request_id')::uuid));
select pg_temp.ok('aucun booking créé', (select count(*) from public.bookings) = 4);

\echo '== 2. Même message relu =='
select pg_temp.intake('{"message_id":"SMS-1","phone":"06 00 00 00 01","first_name":"Autre","message_text":"texte différent"}') as r2 \gset
select pg_temp.ok('même demande renvoyée (duplicate)', (:'r2'::jsonb->>'outcome') = 'duplicate' and (:'r2'::jsonb->>'request_id') = (:'r1'::jsonb->>'request_id'));
select pg_temp.ok('rien n''a changé', (select customer_first_name = 'Inconnue' and customer_message like 'Bonjour%' from public.booking_requests where id = (:'r1'::jsonb->>'request_id')::uuid));
select pg_temp.ok('une seule demande, un seul événement', (select count(*) from public.booking_requests) = 1 and (select count(*) from public.booking_request_intake_events) = 1);
select pg_temp.ok('même identifiant sur un autre canal = autre message', (pg_temp.intake('{"message_id":"SMS-1","channel":"imessage","first_name":"X","phone":"0600000009"}')->>'outcome') = 'created');

\echo '== 3. Rapprochement client =='
select pg_temp.intake('{"message_id":"SMS-3","phone":"+33 6 11 22 33 44","first_name":"Claire"}') as r3 \gset
select pg_temp.ok('client connu par téléphone : e-mail et nom complétés', (select customer_match = 'phone' and customer_email = 'claire@example.test' and customer_last_name = 'Exemple' from public.booking_requests where id = (:'r3'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-4","email":"CLAIRE@example.test","first_name":"Claire"}') as r4 \gset
select pg_temp.ok('client connu par e-mail : téléphone et nom complétés', (select customer_match = 'email' and customer_phone = '+33611223344' and customer_last_name = 'Exemple' from public.booking_requests where id = (:'r4'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-5","phone":"0799887766"}') as r5 \gset
select pg_temp.ok('numéro partagé par deux clients : ambigu, rien de complété', (select customer_match = 'ambiguous' and customer_email is null and needs_review from public.booking_requests where id = (:'r5'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-6","phone":"0611223344","first_name":"Martine"}') as r6 \gset
select pg_temp.ok('même numéro, autre prénom : ambigu, pas de fusion', (select customer_match = 'ambiguous' and customer_email is null from public.booking_requests where id = (:'r6'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-7","phone":"0611223344","first_name":"Claire","email":"autre@example.test"}') as r7 \gset
select pg_temp.ok('numéro connu sous une autre adresse : ambigu', (select customer_match = 'ambiguous' and customer_email = 'autre@example.test' and customer_last_name is null from public.booking_requests where id = (:'r7'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-8","first_name":"Claire","last_name":"Exemple"}') as r8 \gset
select pg_temp.ok('nom seul : jamais rapproché', (select customer_match = 'none' and customer_email is null from public.booking_requests where id = (:'r8'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-9","phone":"0655555555","first_name":"Marc"}') as r9 \gset
select pg_temp.ok('client d''un autre praticien : non rapproché', (select customer_match = 'none' and customer_email is null from public.booking_requests where id = (:'r9'::jsonb->>'request_id')::uuid));

select pg_temp.ok('une demande d''agent ne sert jamais de référence client', (pg_temp.intake('{"message_id":"SMS-9b","phone":"0600000001","first_name":"Inconnue"}')->>'customer_match') = 'none');

\echo '== 3 bis. Référentiel clients (futur import Reservio, fiches fictives) =='
create or replace function pg_temp.cust(id text) returns public.mediumia_customers language sql as $$ select * from public.mediumia_customers where id = id::uuid $$;
select public.upsert_mediumia_customer(:P, 'reservio', null, 'Nadia', 'Réservio', 'Nadia@Example.test', '+33622334455', '2026-09-01') as k1 \gset
select pg_temp.ok('fiche Reservio sans identifiant externe créée, e-mail normalisé, provenance par champ', (:'k1'::jsonb->>'outcome') = 'created' and (select email = 'nadia@example.test' and imported_at is not null and field_sources->'email'->>'source' = 'reservio' from public.mediumia_customers where id = (:'k1'::jsonb->>'customer_id')::uuid));
select public.upsert_mediumia_customer(:P, 'reservio', null, 'nadia', 'RESERVIO', 'nadia@example.test', '+33622334455', '2026-09-01') as k1b \gset
select pg_temp.ok('doublon du fichier (même téléphone + e-mail, même nom) : même fiche, forte confiance', (:'k1b'::jsonb->>'customer_id') = (:'k1'::jsonb->>'customer_id') and (:'k1b'::jsonb->>'confidence') = 'strong' and (:'k1b'::jsonb->>'outcome') = 'unchanged');
select public.upsert_mediumia_customer(:P, 'reservio', null, 'Nadia', null, 'nadia.new@example.test', '+33622334455', '2026-09-20') as k1c \gset
select pg_temp.ok('même téléphone, info plus récente : e-mail mis à jour, nom conservé', (:'k1c'::jsonb->>'outcome') = 'updated' and (select email = 'nadia.new@example.test' and last_name = 'Réservio' from public.mediumia_customers where id = (:'k1'::jsonb->>'customer_id')::uuid));
select public.upsert_mediumia_customer(:P, 'reservio', null, 'Nadia', null, 'nadia.old@example.test', '+33622334455', '2026-06-01') as k1d \gset
select pg_temp.ok('valeur plus ancienne : rien n''est écrasé', (:'k1d'::jsonb->>'outcome') = 'unchanged' and (select email = 'nadia.new@example.test' from public.mediumia_customers where id = (:'k1'::jsonb->>'customer_id')::uuid));
select public.upsert_mediumia_customer(:P, 'reservio', null, 'Nadia', null, 'nadia.sansdate@example.test', '+33622334455', null) as k1e \gset
select pg_temp.ok('valeur sans date : n''écrase jamais', (:'k1e'::jsonb->>'outcome') = 'unchanged' and (select email = 'nadia.new@example.test' from public.mediumia_customers where id = (:'k1'::jsonb->>'customer_id')::uuid));
select public.upsert_mediumia_customer(:P, 'mediumia', null, 'Ines', 'Récente', 'ines.now@example.test', '+33644556677', '2026-09-30') as m1 \gset
select public.upsert_mediumia_customer(:P, 'reservio', null, 'Ines', 'Récente', 'ines.old@example.test', '+33644556677', '2025-05-01') as m2 \gset
select pg_temp.ok('donnée MediumIA plus récente jamais écrasée par une ancienne valeur Reservio', (:'m2'::jsonb->>'customer_id') = (:'m1'::jsonb->>'customer_id') and (select email = 'ines.now@example.test' and field_sources->'email'->>'source' = 'mediumia' from public.mediumia_customers where id = (:'m1'::jsonb->>'customer_id')::uuid));
select public.upsert_mediumia_customer(:P, 'reservio', null, 'Karim', 'Autre', null, '+33622334455', '2026-09-01') as k2 \gset
select pg_temp.ok('même téléphone, autre nom : fiche distincte, les deux marquées ambiguës', (:'k2'::jsonb->>'outcome') = 'created_ambiguous' and (select count(*) from public.mediumia_customers where phone_e164 = '+33622334455' and identity_status = 'ambiguous') = 2);
select public.upsert_mediumia_customer(:P, 'reservio', null, 'Jean', 'Double', 'jean1@example.test', null, '2026-09-01') as j1 \gset
select public.upsert_mediumia_customer(:P, 'reservio', null, 'Jean', 'Double', 'jean2@example.test', null, '2026-09-01') as j2 \gset
select pg_temp.ok('jamais de fusion sur le nom seul : homonymes sans contact commun = deux fiches', (:'j1'::jsonb->>'outcome') = 'created' and (:'j2'::jsonb->>'outcome') = 'created' and (select count(*) from public.mediumia_customers where last_name = 'Double') = 2);
select public.upsert_mediumia_customer(:P, 'reservio', 'R-9', 'Zoé', 'Ext', null, '+33655667788', '2026-09-01') as e1 \gset
select public.upsert_mediumia_customer(:P, 'reservio', 'R-9', 'Zoé', 'Ext', null, '+33655667788', '2026-09-02') as e2 \gset
select pg_temp.ok('identifiant externe : clé exacte, une seule fiche', (:'e1'::jsonb->>'outcome') = 'created' and (:'e2'::jsonb->>'confidence') = 'external_id' and (select count(*) from public.mediumia_customers where external_id = 'R-9') = 1);
select public.upsert_mediumia_customer(:P, 'reservio', null, 'Omar', 'Seul', null, '+33633445566', '2026-09-01') as k3 \gset
\echo '-- Consentements séparés (traces uniquement)'
select public.record_mediumia_customer_consent((:'k3'::jsonb->>'customer_id')::uuid, 'privacy_policy', 'reservio', '2024-03-01') as c1 \gset
select public.record_mediumia_customer_consent((:'k3'::jsonb->>'customer_id')::uuid, 'marketing', 'reservio', '2024-03-01') as c2 \gset
select pg_temp.ok('politique de confidentialité et marketing enregistrés séparément', (:'c1'::jsonb->>'outcome') = 'recorded' and (:'c2'::jsonb->>'outcome') = 'recorded' and (select count(distinct kind) from public.mediumia_customer_consents) = 2);
select pg_temp.ok('consentement déjà tracé : pas de doublon', (public.record_mediumia_customer_consent((:'k3'::jsonb->>'customer_id')::uuid, 'marketing', 'reservio', '2025-01-01')->>'outcome') = 'already_recorded');
select pg_temp.ok('type de consentement inconnu refusé', (public.record_mediumia_customer_consent((:'k3'::jsonb->>'customer_id')::uuid, 'newsletter', 'reservio', now())->>'error') = 'invalid_consent');
\echo '-- Lumia : SMS → téléphone → fiche client → historique → nouvelle demande'
select pg_temp.intake('{"message_id":"SMS-K1","phone":"06 33 44 55 66","first_name":"Omar"}') as i1 \gset
select pg_temp.ok('1. téléphone exact → fiche reliée (client ≠ demande)', (select customer_match = 'phone' and customer_id = (:'k3'::jsonb->>'customer_id')::uuid and id <> customer_id from public.booking_requests where id = (:'i1'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-K2","email":"ines.now@example.test","first_name":"Ines"}') as i2 \gset
select pg_temp.ok('2. e-mail exact → fiche reliée', (select customer_match = 'email' and customer_id = (:'m1'::jsonb->>'customer_id')::uuid from public.booking_requests where id = (:'i2'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-K3","phone":"0622334455","first_name":"Nadia"}') as i3 \gset
select pg_temp.ok('téléphone d''une fiche ambiguë → demande ambiguë, aucune fiche reliée', (select customer_match = 'ambiguous' and customer_id is null and customer_email is null from public.booking_requests where id = (:'i3'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-K4","first_name":"Ines","last_name":"Recente"}') as i4 \gset
select pg_temp.ok('3. nom seul (sans accent) → simple suggestion, aucune fusion', (select customer_match = 'none' and customer_id is null and customer_suggestion_id = (:'m1'::jsonb->>'customer_id')::uuid and customer_email is null from public.booking_requests where id = (:'i4'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-K5","first_name":"Jean","last_name":"Double"}') as i5 \gset
select pg_temp.ok('homonymes → pas même une suggestion', (select customer_suggestion_id is null and customer_id is null from public.booking_requests where id = (:'i5'::jsonb->>'request_id')::uuid));
select pg_temp.ok('historique MediumIA renvoyé pour un client reconnu', (pg_temp.intake('{"message_id":"SMS-K6","phone":"0611223344","first_name":"Claire"}')->'customer_history'->>'bookings')::int = 1);

\echo '== 4. Conversation : la demande est mise à jour (cas B) =='
select pg_temp.intake('{"message_id":"SMS-10","conversation_id":"CONV-A","phone":"0600000010","first_name":"Léa","message_text":"Bonjour, je voudrais un rendez-vous."}') as r10 \gset
select pg_temp.intake('{"message_id":"SMS-11","conversation_id":"CONV-A","phone":"0600000010","message_text":"Vous auriez une place lundi matin ?","preferred_period":"lundi matin","service_hint":"guidance"}') as r11 \gset
select pg_temp.ok('message suivant : même demande mise à jour', (:'r11'::jsonb->>'outcome') = 'updated' and (:'r11'::jsonb->>'request_id') = (:'r10'::jsonb->>'request_id'));
select pg_temp.ok('souhait ajouté, messages conservés dans l''ordre', (select preferred_period = 'lundi matin' and customer_message like 'Bonjour%lundi matin ?' and service_hint = 'guidance' from public.booking_requests where id = (:'r10'::jsonb->>'request_id')::uuid));
select pg_temp.ok('deux événements (created, updated)', (select array_agg(action order by id) from public.booking_request_intake_events where request_id = (:'r10'::jsonb->>'request_id')::uuid) = array['created','updated']);
select pg_temp.ok('relecture du 2e message : duplicate', (pg_temp.intake('{"message_id":"SMS-11","conversation_id":"CONV-A","preferred_period":"autre"}')->>'outcome') = 'duplicate');
select pg_temp.ok('aucun booking créé', (select count(*) from public.bookings) = 4);

\echo '== 4 bis. Visio : WhatsApp / FaceTime / à préciser (jamais Google Meet) =='
select pg_temp.intake('{"message_id":"V-1","modality":"video","video_channel":"whatsapp","phone":"0600000201","message_text":"visio par WhatsApp"}') as v1 \gset
select pg_temp.ok('visio WhatsApp dite par le client → whatsapp', (select requested_modality = 'video' and video_channel = 'whatsapp' from public.booking_requests where id = (:'v1'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"V-2","modality":"video","video_channel":"facetime","phone":"0600000202"}') as v2 \gset
select pg_temp.ok('visio FaceTime → facetime', (select video_channel = 'facetime' from public.booking_requests where id = (:'v2'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"V-3","modality":"video","phone":"0600000203","message_text":"en visio"}') as v3 \gset
select pg_temp.ok('« visio » seulement → a_preciser', (select video_channel = 'a_preciser' from public.booking_requests where id = (:'v3'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"V-4","modality":"video","video_channel":"meet","phone":"0600000204"}') as v4 \gset
select pg_temp.ok('autre outil (meet, zoom…) jamais retenu → a_preciser', (select video_channel = 'a_preciser' from public.booking_requests where id = (:'v4'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"V-5","modality":"in-person","video_channel":"whatsapp","phone":"0600000205"}') as v5 \gset
select pg_temp.ok('demande en présence : aucun canal visio', (select video_channel is null from public.booking_requests where id = (:'v5'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"V-6","conversation_id":"CONV-V","modality":"video","phone":"0600000206","message_text":"une visio ?"}') as v6 \gset
select pg_temp.intake('{"message_id":"V-7","conversation_id":"CONV-V","video_channel":"whatsapp","message_text":"plutôt par WhatsApp"}') as v7 \gset
select pg_temp.ok('message suivant de la conversation : à préciser → WhatsApp', (:'v7'::jsonb->>'outcome') = 'updated' and (select requested_modality = 'video' and video_channel = 'whatsapp' from public.booking_requests where id = (:'v6'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"V-8","conversation_id":"CONV-V","message_text":"merci"}') as v8 \gset
select pg_temp.ok('un message sans canal ne remet pas « à préciser »', (select video_channel = 'whatsapp' from public.booking_requests where id = (:'v6'::jsonb->>'request_id')::uuid));
do $$ begin
  update public.booking_requests set video_channel = 'whatsapp' where source_message_id = 'V-5';
  raise exception 'contrainte manquante';
exception when check_violation then raise notice 'OK  canal visio impossible sur une demande qui n''est pas en visio'; end $$;

select pg_temp.intake(jsonb_build_object('message_id','S-1','conversation_id','CONV-S','phone','0600000401','proposed_starts_at', (date_trunc('day', now()) + interval '11 days 12 hours')::text)) as s1 \gset
select pg_temp.intake('{"message_id":"S-2","conversation_id":"CONV-S","message_text":"merci"}') as s2 \gset
select pg_temp.ok('message de suivi sans créneau : le créneau stocké est conservé', (:'s2'::jsonb->>'outcome') = 'updated' and (select proposed_starts_at = date_trunc('day', now()) + interval '11 days 12 hours' from public.booking_requests where id = (:'s1'::jsonb->>'request_id')::uuid));

\echo '== 5. Créneau précis demandé (cas C) puis confirmation par le flux existant =='
select pg_temp.intake(jsonb_build_object('message_id','SMS-12','phone','0611223344','first_name','Claire','service_id','bbbbbbbb-0000-0000-0000-000000000001','modality','video',
  'proposed_starts_at', (date_trunc('day', now()) + interval '12 days 12 hours')::text, 'message_text','Je voudrais mardi à 14h en visio.')) as r12 \gset
select pg_temp.ok('demande pending avec créneau proposé, sans booking', (select status = 'pending' and proposed_starts_at is not null and confirmed_booking_id is null and not needs_review from public.booking_requests where id = (:'r12'::jsonb->>'request_id')::uuid) and (select count(*) from public.bookings) = 4);
select public.confirm_booking_request((:'r12'::jsonb->>'request_id')::uuid, :P, (select proposed_starts_at from public.booking_requests where id = (:'r12'::jsonb->>'request_id')::uuid), 0, 7000, null) as c1 \gset
select pg_temp.ok('confirmation existante : booking créé', (:'c1'::jsonb->>'success')::boolean and (select count(*) from public.bookings) = 5);
select pg_temp.ok('demande planifiée, booking relié', (select status = 'scheduled' and confirmed_booking_id = (:'c1'::jsonb->>'booking_id')::uuid from public.booking_requests where id = (:'r12'::jsonb->>'request_id')::uuid));
select pg_temp.ok('booking aux coordonnées du client connu', (select customer_email = 'claire@example.test' and customer_last_name = 'Exemple' and status = 'confirmed' from public.bookings where id = (:'c1'::jsonb->>'booking_id')::uuid));
select pg_temp.ok('demande Lumia (prestation à arrhes) confirmée à la main → booking « manual », sans paiement', (select booking_source = 'manual' and booked_price_cents is null and reservation_payment_cents is null from public.bookings where id = (:'c1'::jsonb->>'booking_id')::uuid));
insert into public.booking_requests(id, practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, customer_phone, address_line1, postal_code, city, status)
values ('cccccccc-0000-0000-0000-000000000001', :P, 'bbbbbbbb-0000-0000-0000-000000000003', 'Paul', 'Site', 'paul.site@example.test', '0600000301', '1 rue Exemple', '59000', 'Lille', 'pending');
select public.confirm_booking_request('cccccccc-0000-0000-0000-000000000001', :P, date_trunc('day', now()) + interval '15 days 9 hours', 0, 15000, null) as c2 \gset
select pg_temp.ok('demande du formulaire du site : booking « mediumia », comportement inchangé', (:'c2'::jsonb->>'success')::boolean and (select booking_source = 'mediumia' from public.bookings where id = (:'c2'::jsonb->>'booking_id')::uuid));
do $$ begin
  insert into public.bookings(practitioner_id, service_id, starts_at, ends_at, customer_first_name, customer_last_name, customer_email, booking_source)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', now() + interval '20 days', now() + interval '20 days 1 hour', 'Public', 'Sans arrhes', 'public@example.test', 'mediumia');
  raise exception 'garde-fou contourné';
exception when check_violation then
  if sqlerrm <> 'reservation_payment_required' then raise; end if;
  raise notice 'OK  réservation publique « mediumia » sans arrhes : toujours refusée (reservation_payment_required)';
end $$;
select pg_temp.ok('demande sans prestation : confirmation refusée', (public.confirm_booking_request((:'r1'::jsonb->>'request_id')::uuid, :P, now() + interval '20 days', 0, null, null)->>'error') = 'service_not_found');
select pg_temp.ok('nouveau message après planification : nouvelle demande', (pg_temp.intake('{"message_id":"SMS-13","conversation_id":"CONV-A","message_text":"merci"}')->>'outcome') in ('created','updated'));

\echo '== 6. Contraintes =='
do $$ begin
  begin
    insert into public.booking_requests(practitioner_id, service_id, customer_first_name, status) values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Web','pending');
    raise exception 'contrainte manquante';
  exception when check_violation then raise notice 'OK  formulaire du site : champs toujours obligatoires'; end;
  begin
    perform public.lumia_upsert_booking_request('aaaaaaaa-0000-0000-0000-000000000001', '{"agent":"lumia","channel":"pigeon","message_id":"X"}');
    raise exception 'contrainte manquante';
  exception when check_violation then raise notice 'OK  canal inconnu refusé'; end;
end $$;
select pg_temp.ok('fonction : appel incomplet refusé', (public.lumia_upsert_booking_request(:P, '{"agent":"lumia","channel":"sms"}')->>'error') = 'invalid_intake');
reset role;
\echo 'TOUS LES SCÉNARIOS SÉQUENTIELS SONT PASSÉS'
