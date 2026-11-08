"""Génère les 3 fichiers de fin de rattrapage de la base TEST.

État de départ (08/11/2026) : B2-00 contrôlé, blocs 1 et 2 appliqués par le
connecteur Supabase (b2_10_bloc1_..., b2_10_bloc2_pro_workspace_shadow_fk_indexes).

Chaque fichier : une seule transaction ; garde « TEST uniquement » ; refus d'une
seconde exécution et d'un fichier sauté (contrôle par NOM dans
supabase_migrations.schema_migrations) ; inscription dans cet historique.

Usage : python3 generer.py <racine supabase/> <dossier de sortie>"""
import re
import sys
from pathlib import Path

src = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
M = src / 'migrations'
R = src / 'runbooks' / '20261108-environment-separation'
T = R / 'test-rattrapage'
TX = re.compile(r'^\s*(begin|commit)\s*;\s*(--.*)?$', re.I)

START = ['b2_10_bloc1_oracle_pro_waitlist_reseau_order_intents', 'b2_10_bloc2_pro_workspace_shadow_fk_indexes']

FILES = [
    ('1-b2-10-fin-migrations-du-depot.sql', 'B2-10 (fin) : 11 migrations du dépôt, de document_shadow à rdv_appointment_reminder', [
        ('20261108200100', 'b2_10_bloc3_document_shadow_a_rdv_appointment_reminder', [M / f for f in [
            '20260910184117_mediumia_pro_phase1b_document_shadow.sql',
            '20260911120000_mediumia_pro_phase1b_edge_bridge_support.sql',
            '20260923180000_customer_reviews.sql',
            '20260924100000_rdv_review_requests.sql',
            '20260924120000_gift_cards.sql',
            '20260924204500_conference_raffle_eligibility.sql',
            '20260925090000_defi_intuition_reminders.sql',
            '20260926100000_formation_parcours_597.sql',
            '20260927150800_mediumia_pro_reseau_invitations.sql',
            '20260928200000_mediumia_pro_public_assistant.sql',
            '20260929101207_rdv_appointment_reminder.sql']]),
    ]),
    ('2-b2-20-b2-30-alignement.sql', 'B2-20 et B2-30 : objets hors dépôt et alignement des 29 fonctions sur la Production', [
        ('20261108200200', 'b2_20_objets_hors_depot', [T / '20-objets-hors-depot.sql']),
        ('20261108200300', 'b2_30_alignement_fonctions', [T / '30-alignement-fonctions.sql']),
    ]),
    ('3-garde-environnement-et-signalements.sql', 'Garde TEST/PROD (marqueur « test ») et signalement des problèmes de paiement', [
        ('20261108200400', 'environment_separation_guard', [M / '20261108130000_environment_separation_guard.sql']),
        ('20261108200500', 'activer_test_marqueur', [R / 'activer-test.sql']),
        ('20261108200600', 'payment_issue_reports', [M / '20261108140000_payment_issue_reports.sql']),
    ]),
]


def sql_list(names):
    return ", ".join(f"'{n}'" for n in names)


def body(path):
    lines = [l for l in path.read_text().splitlines() if not TX.match(l)]
    return f"-- >>> {path.relative_to(src)}\n" + "\n".join(lines).rstrip() + "\n"


previous = list(START)
for name, title, entries in FILES:
    names = [n for _, n, _ in entries]
    parts = [f"""-- MediumIA — rattrapage de la base TEST — {title}
-- Projet : MediumIA RDV PayPal Test (wnbwhnqiulsdjcvkuwos) UNIQUEMENT.
-- Fichier généré par generer.py (ne pas modifier à la main).
-- Tout ou rien : en cas d'erreur, rien n'est conservé. Refusé sur la Production,
-- refusé s'il a déjà été exécuté ou si l'étape précédente manque.
-- Inscrit dans l'historique : {", ".join(names)}.
begin;

do $garde$
begin
  if exists (select 1 from public.booking_services where id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c')
     or not exists (select 1 from public.booking_practitioners where slug = 'seb-test') then
    raise exception 'ARRET : cette base n''est pas TEST (wnbwhnqiulsdjcvkuwos). Rien n''a été modifié.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where name in ({sql_list(names)})) then
    raise exception 'ARRET : ce fichier a déjà été exécuté sur TEST. Rien n''a été modifié.';
  end if;
  if (select count(distinct name) from supabase_migrations.schema_migrations where name in ({sql_list(previous)})) <> {len(previous)} then
    raise exception 'ARRET : une étape précédente manque. Rien n''a été modifié.';
  end if;
end $garde$;
"""]
    for version, mig, paths in entries:
        for p in paths:
            parts.append(body(p))
        parts.append(f"insert into supabase_migrations.schema_migrations (version, name, created_by) values ('{version}', '{mig}', 'rattrapage-test');\n")
    parts.append("commit;\n\nselect version, name from supabase_migrations.schema_migrations order by version desc limit 5;\n")
    (out / name).write_text("\n".join(parts))
    print(name, (out / name).stat().st_size, 'octets')
    previous += names
