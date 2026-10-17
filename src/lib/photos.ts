import { supabase } from "@/integrations/supabase/client";
import { describePhoto } from "./agent";

/** Largest side after compression, in pixels. */
export const MAX_PHOTO_SIDE = 1600;

/** Target size keeping aspect ratio, never upscaling. */
export function fitWithin(w: number, h: number, max = MAX_PHOTO_SIDE): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

/** Downscales a picked/captured photo to max 1600px (JPEG, respects EXIF rotation). */
export async function compressImage(file: File, max = MAX_PHOTO_SIDE): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { w, h } = fitWithin(bmp.width, bmp.height, max);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file; // format the browser can't decode — upload as-is
  }
}

/** Compresses, uploads to the private photos bucket, records the photo and asks the agents to describe it. */
export async function sharePhoto(roomId: string, uploaderId: string, file: File, group = false) {
  const blob = await compressImage(file);
  const path = `${roomId}/${group ? "group-" : ""}${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("photos").upload(path, blob, { contentType: blob.type || "image/jpeg" });
  if (error) throw error;
  const { data, error: e2 } = await supabase.from("photos").insert({ room_id: roomId, uploader_id: uploaderId, storage_path: path }).select().single();
  if (e2) throw e2;
  describePhoto(data.id).catch(() => {}); // captions arrive in realtime; placeholder shimmers until then
  return data;
}

export const isGroupPhoto = (path: string) => path.includes("/group-");
