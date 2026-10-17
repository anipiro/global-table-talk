-- Moves a line to the right speaker and applies the same correction to nearby overlapping
-- flagged lines (within 6 seconds, same wrongly attributed speaker). Clears their ambiguous flag.
-- Returns how many lines were changed.
CREATE OR REPLACE FUNCTION public.reassign_line(p_line_id uuid, p_speaker_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_line record;
  v_count integer;
BEGIN
  SELECT id, room_id, speaker_id, created_at INTO v_line FROM public.lines WHERE id = p_line_id;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'Line not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_speaker_id AND room_id = v_line.room_id) THEN
    RAISE EXCEPTION 'Speaker is not at this table';
  END IF;

  UPDATE public.lines l
  SET speaker_id = p_speaker_id, ambiguous = false
  WHERE l.room_id = v_line.room_id
    AND (
      l.id = p_line_id
      OR (
        l.ambiguous
        AND l.speaker_id IS NOT DISTINCT FROM v_line.speaker_id
        AND l.created_at BETWEEN v_line.created_at - interval '6 seconds' AND v_line.created_at + interval '6 seconds'
      )
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reassign_line(uuid, uuid) TO anon, authenticated, service_role;