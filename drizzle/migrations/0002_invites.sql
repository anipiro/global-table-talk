CREATE TABLE public.invites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE, token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text,'-',''), created_by uuid REFERENCES public.members(id) ON DELETE SET NULL, expires_at timestamptz NOT NULL DEFAULT now() + interval '12 hours', revoked_at timestamptz, uses integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO anon, authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest access" ON public.invites FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.invites REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.invites;
ALTER TABLE public.members ADD COLUMN invite_id uuid REFERENCES public.invites(id) ON DELETE SET NULL;