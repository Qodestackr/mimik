import { strFromU8, unzipSync } from 'fflate';
import { BundleError, type BundleManifest, MANIFEST_PATH, parseManifest } from './schema';

export interface ParsedBundle {
  manifest: BundleManifest;
  /** Zip entry path → image, for the screenshots the manifest actually points at. */
  images: Map<string, Blob>;
}

/** 200MB of decompressed entries is far past any real guide and well short of an OOM. */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;

/** A compressed bundle this large is not a guide; reject before reading it into memory. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Reads a `.mimik` file from disk. Everything in it is untrusted: the manifest is
 * validated, entries it does not reference are ignored, and a file that is not a
 * bundle fails with a reason the import screen can show.
 */
export async function readBundle(file: Blob): Promise<ParsedBundle> {
  if (file.size > MAX_FILE_BYTES) throw new BundleError('unreadable', 'bundle is implausibly large');

  let entries: Record<string, Uint8Array>;
  try {
    // Deliberately the synchronous API. fflate's async variant runs in a Worker
    // built from a blob: URL, which Firefox's extension CSP refuses to execute —
    // the callback then never fires and the import hangs on its spinner forever.
    // Screenshots are stored uncompressed, so there is little to inflate anyway.
    //
    // The filter runs against the central directory before anything is inflated,
    // so a zip bomb is refused while it is still a few kilobytes on disk. Summing
    // the entries afterwards would only measure memory already committed.
    let unpacked = 0;
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        unpacked += entry.originalSize;
        if (unpacked > MAX_UNPACKED_BYTES) throw new Error('bundle is implausibly large');
        return true;
      },
    });
  } catch {
    throw new BundleError('unreadable', 'file could not be unzipped');
  }

  const manifestEntry = entries[MANIFEST_PATH];
  if (!manifestEntry) throw new BundleError('not-a-bundle', `no ${MANIFEST_PATH} in the archive`);

  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(manifestEntry));
  } catch {
    throw new BundleError('not-a-bundle', `${MANIFEST_PATH} is not valid JSON`);
  }

  const manifest = parseManifest(raw);

  const images = new Map<string, Blob>();
  for (const shot of manifest.screenshots) {
    const entry = entries[shot.file];
    if (entry) images.set(shot.file, new Blob([entry as unknown as BlobPart], { type: shot.mimeType }));
  }

  return { manifest, images };
}
