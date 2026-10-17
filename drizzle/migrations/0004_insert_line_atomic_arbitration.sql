CREATE OR REPLACE FUNCTION public.insert_line(
  p_room_id uuid,
  p_speaker_id uuid,
  p_text text,
  p_language text,
  p_loudness double precision
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_my_level double precision;
  v_other record;
  v_other_level double precision;
BEGIN
  SELECT voice_level INTO v_my_level FROM public.members WHERE id = p_speaker_id;

  INSERT INTO public.lines (room_id, speaker_id, text, language, loudness)
  VALUES (p_room_id, p_speaker_id, p_text, p_language, p_loudness)
  RETURNING id INTO v_id;

  -- Loudest phone wins: within a 2-second window, keep only the line that is
  -- louder relative to its member's calibrated voice_level. Row locks make the
  -- arbitration atomic so two simultaneous inserts cannot both survive.
  FOR v_other IN
    SELECT l.id, l.loudness, l.speaker_id
    FROM public.lines l
    WHERE l.room_id = p_room_id
      AND l.id <> v_id
      AND l.speaker_id IS DISTINCT FROM p_speaker_id
      AND l.created_at >= now() - interval '2 seconds'
    FOR UPDATE OF l
  LOOP
    SELECT voice_level INTO v_other_level FROM public.members WHERE id = v_other.speaker_id;
    IF p_loudness / COALESCE(NULLIF(v_my_level, 0), 1) >= v_other.loudness / COALESCE(NULLIF(v_other_level, 0), 1) THEN
      DELETE FROM public.lines WHERE id = v_other.id;
    ELSE
      DELETE FROM public.lines WHERE id = v_id;
      RETURN NULL;
    END IF;
  END LOOP;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_line(uuid, uuid, text, text, double precision) TO anon;
GRANT EXECUTE ON FUNCTION public.insert_line(uuid, uuid, text, text, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_line(uuid, uuid, text, text, double precision) TO service_role;

ALTER TABLE public.members ADD COLUMN voice_calibrated_at timestamptz;
ALTER TABLE public.members ADD COLUMN voice_device text;
COMMENT ON COLUMN public.members.voice_calibrated_at IS 'When voice_level was last calibrated.';
COMMENT ON COLUMN public.members.voice_device IS 'Device label (user agent family) at calibration time; a different current device flags recalibration.';