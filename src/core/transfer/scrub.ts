export const SCRUB_PLACEHOLDER = '…';

/**
 * Bare values shorter than this are left alone. A three-letter value is as likely
 * to be a word inside an unrelated sentence as it is to be the secret, and
 * mangling the guide's prose is a worse trade than leaving a short value in.
 * The quoted form is replaced at any length, because that one is unambiguous.
 */
export const MIN_BARE_SCRUB = 4;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes typed field values from text that is about to leave the browser.
 *
 * Stripping `step.inputValue` is not enough on its own: the capture pipeline also
 * writes the value into the step description (`Type "hunter2" in Search`), and an
 * AI-written title or description can quote it again. Those are copies of the same
 * secret, so they have to go the same way.
 *
 * Two passes, because they carry different risks. The quoted form is exactly what
 * the description template produces, so it is replaced whatever its length. A bare
 * occurrence could be an ordinary word, so it is only replaced once it is long
 * enough to be unlikely to collide.
 */
export function scrubValues(text: string, values: readonly string[]): string {
  let out = text;

  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const escaped = escapeRegExp(value);

    out = out.replace(new RegExp(`"${escaped}"`, 'gi'), `"${SCRUB_PLACEHOLDER}"`);
    if (value.length >= MIN_BARE_SCRUB) {
      out = out.replace(new RegExp(escaped, 'gi'), SCRUB_PLACEHOLDER);
    }
  }

  return out;
}

/** How far `getCleanText` truncates captured element text. Keep in step with element-meta.ts. */
const CAPTURED_TEXT_LIMIT = 80;

/**
 * The forms one typed value can take elsewhere in the guide.
 *
 * `elementMeta.textContent` is not a copy of `inputValue` — `getCleanText` keeps
 * only the first meaningful line of `innerText`, cut to 80 characters. A literal
 * search for the whole value therefore sails straight past it, so the shortened
 * forms have to be searched for too.
 */
function variantsOf(value: string): string[] {
  const variants = new Set<string>([value]);
  const firstLine = value
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 2);

  for (const candidate of [firstLine, value.slice(0, CAPTURED_TEXT_LIMIT), firstLine?.slice(0, CAPTURED_TEXT_LIMIT)]) {
    if (candidate && candidate.length >= MIN_BARE_SCRUB) variants.add(candidate);
  }
  return [...variants];
}

/** Every distinct value typed anywhere in the guide — a later step can echo an earlier one. */
export function typedValues(steps: readonly { inputValue?: string }[]): string[] {
  const values = new Set<string>();
  for (const step of steps) {
    const value = step.inputValue?.trim();
    if (!value) continue;
    for (const variant of variantsOf(value)) values.add(variant);
  }
  // Longest first, so a value containing another is replaced before its substring.
  return [...values].sort((a, b) => b.length - a.length);
}
