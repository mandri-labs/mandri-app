import type { TranscriptImage as ImageReference } from "../parse/images";
import { ImageView } from "@/features/canvas/ImageView";
import "@/features/canvas/canvas.css";
export function TranscriptImage({
  image,
  sessionId,
}: {
  image: ImageReference;
  sessionId?: string;
}) {
  return (
    <ImageView
      compact
      sessionId={sessionId}
      target={{
        kind: "image",
        source: image.source,
        file: image.file,
        path: image.path,
        title:
          image.name ||
          (image.path ?? (image.source.startsWith("data:") ? "Image" : image.source))
            .split(/[\\/]/)
            .pop()
            ?.split("?")[0] ||
          "Image",
      }}
    />
  );
}
