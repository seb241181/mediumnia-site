-- Cache for geocoding results (Nominatim or any future provider).
-- Stores only a SHA-256 hash of the normalized place string and the
-- geographic data needed by the astrology engine.  No personal data
-- (name, date, time of birth) is ever stored here.

create table if not exists geocoding_cache (
  place_hash text primary key,
  lat double precision not null,
  lon double precision not null,
  display_name text not null,
  country_code text,
  timezone text not null,
  created_at timestamptz not null default now()
);

alter table geocoding_cache enable row level security;

-- Global rate-limiter for outbound geocoding requests.
-- Single-row table; the atomic RPC below enforces max 1 req/s across
-- all serverless instances.

create table if not exists geocoding_rate_limit (
  id integer primary key default 1 check (id = 1),
  last_request_at timestamptz not null default '1970-01-01T00:00:00Z'
);

insert into geocoding_rate_limit (id, last_request_at)
values (1, '1970-01-01T00:00:00Z')
on conflict (id) do nothing;

alter table geocoding_rate_limit enable row level security;

-- Atomically claims a geocoding slot if the last request was >1 s ago.
-- Returns true when the caller may proceed, false otherwise.
create or replace function claim_geocoding_slot()
returns boolean
language plpgsql
as $$
declare
  affected integer;
begin
  update geocoding_rate_limit
     set last_request_at = now()
   where id = 1
     and last_request_at < now() - interval '1 second';

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;
