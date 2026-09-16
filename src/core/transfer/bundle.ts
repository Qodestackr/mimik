import { strToU8, zipSync } from 'fflate';
import { extractDomain } from '@/core/export/utils';
import type { Guide, Screenshot, Step } from '@/core/guides/types';
import { flattenScreenshot } from './flatten';
import {
  BUNDLE_MIME,
  BUNDLE_VERSION,
  type BundleManifest,
  type BundleScreenshot,
  type BundleStep,
  MANIFEST_PATH,
  README_PATH,
  SCREENSHOT_DIR,
} from './schema';
import { scrubValues, typedValues } from './scrub';

export type BundleUrlMode = 'full' | 'path' | 'origin';

export interface BundleOptions {
  /** Typed text can be a name, a token, or a password nobody meant to publish. */
  stripInputValues: boolean;
  urls: BundleUrlMode;
}

export const DEFAULT_BUNDLE_OPTIONS: BundleOptions = {
  stripInputValues: true,
  urls: 'path',
};

/** Query strings and fragments carry session tokens far more often than they carry meaning. */
export function trimUrl(url: string, mode: BundleUrlMode): string {
  if (mode === 'full' || !url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  // Opaque-origin schemes (file:, about:, chrome:) report an origin of the
  // literal string "null", so composing origin + pathname would yield
  // "null/Users/…". They have no host to trim down to, so leave them whole.
  if (parsed.origin === 'null') return url;
  return mode === 'origin' ? parsed.origin : `${parsed.origin}${parsed.pathname}`;
}

function bundleStep(step: Step, options: BundleOptions, secrets: readonly string[]): BundleStep {
  const { guideId: _guideId, aiPending: _aiPending, screenshotId: _screenshotId, ...rest } = step;
  const travelling: BundleStep = { ...rest, url: trimUrl(step.url, options.urls) };

  if (options.stripInputValues) {
    delete travelling.inputValue;
    // The value is also written into the description at capture time, and an AI
    // description can quote it again. Removing one copy and shipping the other
    // would make the setting a lie.
    travelling.description = scrubValues(travelling.description, secrets);
  }

  if (travelling.elementMeta) {
    const meta = travelling.elementMeta;
    // For the field that was typed into, the captured text *is* the typed value —
    // stored truncated, so a literal scrub can miss it. Drop it outright: Guide Me
    // matches a field on its selector, label and placeholder, never on the text
    // the author happened to put in it.
    const ownText = options.stripInputValues && step.inputValue ? null : meta.textContent;
    travelling.elementMeta = {
      ...meta,
      href: meta.href ? trimUrl(meta.href, options.urls) : null,
      textContent: ownText && options.stripInputValues ? scrubValues(ownText, secrets) : ownText,
    };
  }

  return travelling;
}

/**
 * Packs a guide into a `.mimik` zip another Mimik can import.
 *
 * Screenshots are flattened first, so redactions are gone rather than merely
 * hidden. A plain-markdown `README.md` rides along so the file still says
 * something to someone who does not have Mimik installed.
 */
export async function exportGuideAsBundle(
  guide: Guide,
  steps: Step[],
  screenshots: Map<string, Screenshot>,
  options: BundleOptions = DEFAULT_BUNDLE_OPTIONS,
): Promise<Blob> {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const manifestScreenshots: BundleScreenshot[] = [];
  let anyRedaction = false;

  for (const step of steps) {
    const screenshot = screenshots.get(step.id);
    if (!screenshot) continue;

    const { meta, blob, redacted } = await flattenScreenshot(screenshot);
    anyRedaction ||= redacted;

    const file = `${SCREENSHOT_DIR}/${meta.id}.webp`;
    // Already-compressed webp: deflating it again costs time and saves nothing.
    files[file] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];

    manifestScreenshots.push({
      id: meta.id,
      stepId: meta.stepId,
      file,
      mimeType: meta.mimeType,
      width: meta.width,
      height: meta.height,
      ...(meta.bounds ? { bounds: meta.bounds } : {}),
      ...(meta.pixelRatio !== undefined ? { pixelRatio: meta.pixelRatio } : {}),
      ...(meta.clickPoint ? { clickPoint: meta.clickPoint } : {}),
      ...(meta.edits ? { edits: meta.edits } : {}),
    });
  }

  const secrets = options.stripInputValues ? typedValues(steps) : [];
  const scrub = (text: string) => (options.stripInputValues ? scrubValues(text, secrets) : text);

  const manifest: BundleManifest = {
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    guide: {
      // An AI title is written from the step descriptions, so it can carry the
      // typed value through even though nobody typed it into the title.
      title: scrub(guide.title),
      ...(guide.description ? { description: scrub(guide.description) } : {}),
      createdAt: guide.createdAt,
    },
    sourceDomain: extractDomain(steps),
    redacted: {
      screenshots: anyRedaction,
      inputValues: options.stripInputValues,
      urls: options.urls,
    },
    steps: steps.map((step) => bundleStep(step, options, secrets)),
    screenshots: manifestScreenshots,
  };

  files[MANIFEST_PATH] = strToU8(JSON.stringify(manifest, null, 2));

  // The README is generated from the guide, so it needs the same scrubbing the
  // manifest got — otherwise the value walks out in the readable copy instead.
  const { exportGuideAsMarkdown } = await import('@/core/export/markdown-export');
  const readmeGuide: Guide = {
    ...guide,
    title: manifest.guide.title,
    ...(guide.description ? { description: scrub(guide.description) } : {}),
  };
  const readmeSteps = steps.map((step) => ({ ...step, description: scrub(step.description) }));
  files[README_PATH] = strToU8(await exportGuideAsMarkdown(readmeGuide, readmeSteps, screenshots));

  // Synchronous for the same reason as readBundle: the async variant needs a
  // blob: Worker that Firefox's extension CSP blocks.
  const zipped = zipSync(files);
  return new Blob([zipped as unknown as BlobPart], { type: BUNDLE_MIME });
}
