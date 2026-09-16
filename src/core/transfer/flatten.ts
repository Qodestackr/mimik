import type { Screenshot } from '@/core/guides/types';
import { moveAnnotation, resolveTarget } from '@/core/screenshot/geometry';
import { renderScreenshot } from '@/core/screenshot/render';
import type { ScreenshotEdits } from '@/core/screenshot/types';

export interface FlattenedScreenshot {
  meta: Omit<Screenshot, 'blob'>;
  blob: Blob;
  /**
   * True only when a redaction was burnt in. A crop also destroys pixels, but
   * the recipient is told "blurred areas were removed", and saying that about a
   * screenshot the author merely zoomed would be a lie.
   */
  redacted: boolean;
}

const FORMAT = 'image/webp';
const QUALITY = 0.9;

/**
 * Prepares a screenshot to leave this browser.
 *
 * A `redact` annotation is drawn at render time, so `screenshot.blob` still holds
 * the unblurred capture underneath it. Shipping that blob would hand the recipient
 * everything the author hid. So redactions are burnt into the pixels here and then
 * dropped from `edits`, leaving nothing to undo.
 *
 * An explicit crop is baked for the same reason — framing is sometimes how people
 * hide things. The automatic zoom-to-target crop is presentation rather than
 * concealment, so it stays as data and travels untouched.
 *
 * Everything else — the target outline, boxes, arrows, text — stays editable.
 */
export async function flattenScreenshot(screenshot: Screenshot): Promise<FlattenedScreenshot> {
  const crop = screenshot.edits?.viewport;
  const frame = crop ?? { x: 0, y: 0, width: screenshot.width, height: screenshot.height };
  const hadRedactions = (screenshot.edits?.annotations ?? []).some((a) => a.type === 'redact');

  const blob = await renderScreenshot(screenshot, {
    format: FORMAT,
    quality: QUALITY,
    viewport: frame,
    target: false,
    annotations: 'redactions',
  });

  const kept = (screenshot.edits?.annotations ?? []).filter((a) => a.type !== 'redact');
  const edits: ScreenshotEdits = {};
  if (screenshot.edits?.alt) edits.alt = screenshot.edits.alt;

  if (!crop) {
    if (kept.length > 0) edits.annotations = kept;
    if (screenshot.edits?.target !== undefined) edits.target = screenshot.edits.target;

    return {
      meta: {
        ...stripBlob(screenshot),
        edits: Object.keys(edits).length > 0 ? edits : undefined,
      },
      blob,
      redacted: hadRedactions,
    };
  }

  // The crop is now the whole image, so every coordinate moves with it.
  if (kept.length > 0) edits.annotations = kept.map((a) => moveAnnotation(a, -crop.x, -crop.y));

  // `bounds` is in CSS pixels and only exists so the target and auto-crop can be
  // derived. Resolve it once, rebase it, and drop the source — a rebased image
  // must never be re-derived from pre-crop coordinates.
  const target = resolveTarget(screenshot);
  edits.target = target
    ? { ...target, x: target.x - crop.x, y: target.y - crop.y }
    : (screenshot.edits?.target ?? null);

  return {
    meta: {
      id: screenshot.id,
      stepId: screenshot.stepId,
      mimeType: FORMAT,
      width: Math.round(crop.width),
      height: Math.round(crop.height),
      edits,
    },
    blob,
    redacted: hadRedactions,
  };
}

function stripBlob(screenshot: Screenshot): Omit<Screenshot, 'blob' | 'edits'> {
  const { blob: _blob, edits: _edits, ...rest } = screenshot;
  return { ...rest, mimeType: FORMAT };
}
