-- Loudest phone wins on raw loudness: voice setups vary a lot between phones, and dividing by them
-- let a quiet-calibrated phone "win" its neighbour's sentences.
CREATE OR REPLACE FUNCTION public.insert_line(p_room_id uuid, p_speaker_id uuid, p_text text, p_language text, p_loudness double precision)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_other record;
  v_sim double precision;
  v_ambiguous boolean := false;
BEGIN
  INSERT INTO public.lines (room_id, speaker_id, text, language, loudness)
  VALUES (p_room_id, p_speaker_id, p_text, p_language, p_loudness)
  RETURNING id INTO v_id;

  FOR v_other IN
    SELECT l.id, l.loudness, l.text, l.ambiguous
    FROM public.lines l
    WHERE l.room_id = p_room_id
      AND l.id <> v_id
      AND l.speaker_id IS DISTINCT FROM p_speaker_id
      AND l.created_at >= now() - interval '6 seconds'
    ORDER BY l.created_at
    FOR UPDATE OF l
  LOOP
    v_sim := public.line_similarity(p_text, v_other.text);
    IF v_sim >= 0.5 THEN
      IF p_loudness >= v_other.loudness THEN
        DELETE FROM public.lines WHERE id = v_other.id;
        IF v_other.loudness >= 0.8 * p_loudness OR v_other.ambiguous THEN v_ambiguous := true; END IF;
      ELSE
        IF p_loudness >= 0.8 * v_other.loudness THEN
          UPDATE public.lines SET ambiguous = true WHERE id = v_other.id;
        END IF;
        DELETE FROM public.lines WHERE id = v_id;
        RETURN NULL;
      END IF;
    ELSIF v_sim >= 0.25 THEN
      UPDATE public.lines SET ambiguous = true WHERE id = v_other.id;
      v_ambiguous := true;
    END IF;
  END LOOP;

  IF v_ambiguous THEN
    UPDATE public.lines SET ambiguous = true WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.insert_line(uuid, uuid, text, text, double precision) TO anon, authenticated, service_role;