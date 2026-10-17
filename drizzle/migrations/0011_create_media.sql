CREATE TABLE public.media (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id),
  line_id uuid REFERENCES public.lines(id),
  notebook_id uuid REFERENCES public.notebook(id),
  kind text NOT NULL,
  query text NOT NULL DEFAULT ''::text,
  url text NOT NULL,
  caption_by_language jsonb NOT NULL DEFAULT '{}'::jsonb,
  credit text NOT NULL DEFAULT ''::text,
  created_by_member_id uuid REFERENCES public.members(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media TO anon;
GRANT ALL ON public.media TO service_role;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest access" ON public.media FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.media;