import { NOTE_ATTACHMENT_MAX_BYTES } from "@/notes/noteAttachment";

/** One already-captured, user-visible image. Tool calls carry only its source, never pixels. */
export type NoteAttachmentSource = "screenshot" | "camera_photo" | "selected_file";
export type CapturedImageSource = "screenshot" | "camera_photo";

export interface CapturedNoteImage {
  source: CapturedImageSource;
  capturedAt: string;
  jpeg: string;
}

/** Converts explicitly captured session media to the existing private note-attachment upload. */
export function capturedImageFile(image: CapturedNoteImage): File {
  const binary = atob(image.jpeg);
  if (binary.length < 3 || binary.length > NOTE_ATTACHMENT_MAX_BYTES ||
      binary.charCodeAt(0) !== 0xff || binary.charCodeAt(1) !== 0xd8 || binary.charCodeAt(2) !== 0xff) {
    throw new Error("The captured image is invalid or too large to attach.");
  }
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const stamp = image.capturedAt.replace(/[^0-9T]/g, "-").replace(/-+/g, "-").slice(0, 24);
  const name = `${image.source === "screenshot" ? "screenshot" : "camera-photo"}-${stamp}.jpg`;
  return new File([bytes.buffer], name, { type: "image/jpeg" });
}

/** The Assistant may upload only pixels it captured or a user-selected File, never a guessed disk path. */
export type NoteAttachmentInput = CapturedNoteImage | File;

export function noteAttachmentFile(input: NoteAttachmentInput): File {
  return input instanceof File ? input : capturedImageFile(input);
}
