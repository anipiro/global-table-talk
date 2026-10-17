ALTER TABLE public.lines ADD COLUMN IF NOT EXISTS ambiguous boolean NOT NULL DEFAULT false;

-- Word overlap between two transcripts (0..1): share of the shorter line's words that also
-- appear in the other line. Words match when equal or sharing a 4-letter stem, which
-- tolerates two phones transcribing the same Georgian word with different endings.
CREATE OR REPLACE FUNCTION public.line_similarity(a text, b text)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  wa text[];
  wb text[];
  short_w text[];
  long_w text[];
  w text;
  matched int := 0;
BEGIN
  wa := array_remove(regexp_split_to_array(lower(regexp_replace(coalesce(a, ''), '[[:punct:]«»„“”—–…]', ' ', 'g')), '\s+'), '');
  wb := array_remove(regexp_split_to_array(lower(regexp_replace(coalesce(b, ''), '[[:punct:]«»„“”—–…]', ' ', 'g')), '\s+'), '');
  IF coalesce(array_length(wa, 1), 0) = 0 OR coalesce(array_length(wb, 1), 0) = 0 THEN
    RETURN 0;
  END IF;
  IF array_length(wa, 1) <= array_length(wb, 1) THEN short_w := wa; long_w := wb; ELSE short_w := wb; long_w := wa; END IF;
  FOREACH w IN ARRAY short_w LOOP
    IF EXISTS (
      SELECT 1 FROM unnest(long_w) o
      WHERE o = w OR (char_length(o) >= 4 AND char_length(w) >= 4 AND left(o, 4) = left(w, 4))
    ) THEN
      matched := matched + 1;
    END IF;
  END LOOP;
  RETURN matched::double precision / array_length(short_w, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.line_similarity(text, text) TO anon, authenticated, service_role;

-- Loudest phone wins, per utterance: only lines from other phones in the last 6 seconds whose
-- words mostly match (same sentence heard by two phones) compete; the one louder relative to its
-- member's calibrated voice wins. Near-ties keep the winner flagged ambiguous. Partly matching
-- lines (one phone blended two voices) are both kept and flagged ambiguous. Unrelated lines —
-- real overlapping dialogue — are left untouched.
CREATE OR REPLACE FUNCTION public.insert_line(p_room_id uuid, p_speaker_id uuid, p_text text, p_language text, p_loudness double precision)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_my_level double precision;
  v_my_rel double precision;
  v_other record;
  v_other_rel double precision;
  v_sim double precision;
  v_ambiguous boolean := false;
BEGIN
  SELECT voice_level INTO v_my_level FROM public.members WHERE id = p_speaker_id;
  v_my_rel := p_loudness / COALESCE(NULLIF(v_my_level, 0), 1);

  INSERT INTO public.lines (room_id, speaker_id, text, language, loudness)
  VALUES (p_room_id, p_speaker_id, p_text, p_language, p_loudness)
  RETURNING id INTO v_id;

  FOR v_other IN
    SELECT l.id, l.loudness, l.text, l.ambiguous, m.voice_level
    FROM public.lines l
    LEFT JOIN public.members m ON m.id = l.speaker_id
    WHERE l.room_id = p_room_id
      AND l.id <> v_id
      AND l.speaker_id IS DISTINCT FROM p_speaker_id
      AND l.created_at >= now() - interval '6 seconds'
    ORDER BY l.created_at
    FOR UPDATE OF l
  LOOP
    v_sim := public.line_similarity(p_text, v_other.text);
    IF v_sim >= 0.5 THEN
      v_other_rel := v_other.loudness / COALESCE(NULLIF(v_other.voice_level, 0), 1);
      IF v_my_rel >= v_other_rel THEN
        DELETE FROM public.lines WHERE id = v_other.id;
        IF v_other_rel >= 0.8 * v_my_rel OR v_other.ambiguous THEN v_ambiguous := true; END IF;
      ELSE
        IF v_my_rel >= 0.8 * v_other_rel THEN
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