ALTER TABLE public.cards DROP CONSTRAINT cards_kind_check;
ALTER TABLE public.cards ADD CONSTRAINT cards_kind_check CHECK (kind IN ('context','catchup','recap','shared'));