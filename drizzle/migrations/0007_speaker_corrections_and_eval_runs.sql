CREATE TABLE public.speaker_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  line_id uuid,
  by_member_id uuid,
  to_speaker_id uuid,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speaker_corrections TO anon, authenticated;
GRANT ALL ON public.speaker_corrections TO service_role;
ALTER TABLE public.speaker_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest access" ON public.speaker_corrections FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.speaker_corrections REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.speaker_corrections;

CREATE TABLE public.speaker_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  total integer NOT NULL,
  correct integer NOT NULL,
  ambiguous_expected integer NOT NULL DEFAULT 0,
  ambiguous_caught integer NOT NULL DEFAULT 0,
  device text,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speaker_eval_runs TO anon, authenticated;
GRANT ALL ON public.speaker_eval_runs TO service_role;
ALTER TABLE public.speaker_eval_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest access" ON public.speaker_eval_runs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Reassign + record each changed line (previous speaker and flag) so the correction can be undone.
DROP FUNCTION IF EXISTS public.reassign_line(uuid, uuid);
CREATE FUNCTION public.reassign_line(p_line_id uuid, p_speaker_id uuid, p_by_member_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_line record;
  v_changes jsonb;
  v_id uuid;
BEGIN
  SELECT id, room_id, speaker_id, created_at INTO v_line FROM public.lines WHERE id = p_line_id;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'Line not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_speaker_id AND room_id = v_line.room_id) THEN
    RAISE EXCEPTION 'Speaker is not at this table';
  END IF;

  WITH targets AS (
    SELECT l.id, l.speaker_id, l.ambiguous FROM public.lines l
    WHERE l.room_id = v_line.room_id
      AND (l.id = p_line_id OR (
        l.ambiguous
        AND l.speaker_id IS NOT DISTINCT FROM v_line.speaker_id
        AND l.created_at BETWEEN v_line.created_at - interval '6 seconds' AND v_line.created_at + interval '6 seconds'))
    FOR UPDATE
  ), upd AS (
    UPDATE public.lines l SET speaker_id = p_speaker_id, ambiguous = false
    FROM targets t WHERE l.id = t.id
    RETURNING t.id, t.speaker_id, t.ambiguous
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('line_id', id, 'from_speaker_id', speaker_id, 'was_ambiguous', ambiguous)), '[]'::jsonb)
  INTO v_changes FROM upd;

  INSERT INTO public.speaker_corrections (room_id, line_id, by_member_id, to_speaker_id, changes)
  VALUES (v_line.room_id, p_line_id, p_by_member_id, p_speaker_id, v_changes)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reassign_line(uuid, uuid, uuid) TO anon, authenticated, service_role;

-- Reverts every line a correction changed, unless a later correction already moved that line again.
CREATE OR REPLACE FUNCTION public.undo_speaker_correction(p_correction_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_c record;
  v_change jsonb;
  v_count integer := 0;
  v_n integer;
BEGIN
  SELECT * INTO v_c FROM public.speaker_corrections WHERE id = p_correction_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'Correction not found'; END IF;
  IF v_c.undone_at IS NOT NULL THEN RETURN 0; END IF;
  FOR v_change IN SELECT * FROM jsonb_array_elements(v_c.changes) LOOP
    UPDATE public.lines
    SET speaker_id = NULLIF(v_change->>'from_speaker_id', '')::uuid,
        ambiguous = coalesce((v_change->>'was_ambiguous')::boolean, false)
    WHERE id = (v_change->>'line_id')::uuid
      AND speaker_id IS NOT DISTINCT FROM v_c.to_speaker_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_count := v_count + v_n;
  END LOOP;
  UPDATE public.speaker_corrections SET undone_at = now() WHERE id = p_correction_id;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.undo_speaker_correction(uuid) TO anon, authenticated, service_role;