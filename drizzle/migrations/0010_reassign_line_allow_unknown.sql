-- Same as before, but p_speaker_id may be NULL: "someone not at the table" (Unknown speaker).
CREATE OR REPLACE FUNCTION public.reassign_line(p_line_id uuid, p_speaker_id uuid, p_by_member_id uuid DEFAULT NULL)
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
  IF p_speaker_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_speaker_id AND room_id = v_line.room_id) THEN
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