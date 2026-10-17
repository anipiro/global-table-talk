ALTER TABLE public.lines ADD COLUMN IF NOT EXISTS heard_by uuid REFERENCES public.members(id) ON DELETE SET NULL;
ALTER TABLE public.lines ADD COLUMN IF NOT EXISTS confidence double precision;
ALTER TABLE public.lines ADD COLUMN IF NOT EXISTS delay_ms integer;
COMMENT ON COLUMN public.lines.heard_by IS 'Phone (member) that captured the line; speaker_id is NULL when attribution confidence was too low (Unknown speaker).';
COMMENT ON COLUMN public.lines.confidence IS 'Speaker-attribution confidence 0..1 measured on the capturing phone.';
COMMENT ON COLUMN public.lines.delay_ms IS 'End of speech to line saved, measured on the capturing phone.';

DROP FUNCTION IF EXISTS public.insert_line(uuid, uuid, text, text, double precision);

-- Same-utterance arbitration on raw loudness (see 0008), plus: lines whose attribution confidence is
-- below 0.7 are saved as "Unknown speaker" (speaker_id NULL, heard_by = capturing phone) and flagged.
CREATE FUNCTION public.insert_line(
  p_room_id uuid, p_speaker_id uuid, p_text text, p_language text, p_loudness double precision,
  p_confidence double precision DEFAULT NULL, p_delay_ms integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_other record;
  v_sim double precision;
  v_unknown boolean := p_confidence IS NOT NULL AND p_confidence < 0.7;
  v_ambiguous boolean := p_confidence IS NOT NULL AND p_confidence < 0.7;
BEGIN
  INSERT INTO public.lines (room_id, speaker_id, heard_by, text, language, loudness, confidence, delay_ms, ambiguous)
  VALUES (p_room_id, CASE WHEN v_unknown THEN NULL ELSE p_speaker_id END, p_speaker_id, p_text, p_language, p_loudness, p_confidence, p_delay_ms, v_ambiguous)
  RETURNING id INTO v_id;

  FOR v_other IN
    SELECT l.id, l.loudness, l.text, l.ambiguous
    FROM public.lines l
    WHERE l.room_id = p_room_id
      AND l.id <> v_id
      AND coalesce(l.heard_by, l.speaker_id) IS DISTINCT FROM p_speaker_id
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
GRANT EXECUTE ON FUNCTION public.insert_line(uuid, uuid, text, text, double precision, double precision, integer) TO anon, authenticated, service_role;