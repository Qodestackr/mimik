import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  globalThis.BroadcastChannel = class BroadcastChannel {
    name = 'test';
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    close() {}
    onmessage = null;
    onmessageerror = null;
    dispatchEvent() {
      return true;
    }
  } as unknown as typeof BroadcastChannel;
});

import { db } from '../db';
import {
  appendToStepDescription,
  applyNarrationToSteps,
  attachTranscriptLine,
  createSnapshot,
  deleteTranscripts,
  getTranscripts,
  hasTranscript,
  mergeGuideInto,
  permanentlyDeleteGuide,
  restoreNarratedDescription,
  revertToSnapshot,
  saveTranscript,
  updateStepDescription,
} from '../service';
import type { Step } from '../types';

const SPOKEN = 'Open the billing tab on the left';

function makeStep(id: string, extras?: Partial<Step>): Step {
  return {
    id,
    guideId: 'g1',
    index: 0,
    description: 'Clicked Billing',
    action: 'click',
    url: 'https://example.com/settings',
    timestamp: Date.now(),
    ...extras,
  };
}

beforeEach(async () => {
  await db.guides.add({
    id: 'g1',
    title: 'Test Guide',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stepIds: ['s1'],
    starred: false,
    deletedAt: null,
  });
  await db.steps.add(makeStep('s1'));
});

afterEach(async () => {
  await db.guides.clear();
  await db.steps.clear();
  await db.transcripts.clear();
  await db.screenshots.clear();
  await db.snapshots.clear();
});

describe('the spoken original', () => {
  it('is kept alongside the description narration wrote', async () => {
    await applyNarrationToSteps([{ stepId: 's1', description: SPOKEN }]);

    const step = await db.steps.get('s1');
    expect(step?.description).toBe(SPOKEN);
    expect(step?.narratedDescription).toBe(SPOKEN);
  });

  it('survives an edit that replaces the description', async () => {
    await applyNarrationToSteps([{ stepId: 's1', description: SPOKEN }]);
    await updateStepDescription('s1', 'Click Billing', 'manual');

    const step = await db.steps.get('s1');
    expect(step?.description).toBe('Click Billing');
    expect(step?.descriptionSource).toBe('manual');
    expect(step?.narratedDescription).toBe(SPOKEN);
  });

  it('can be put back after an edit, source and all', async () => {
    await applyNarrationToSteps([{ stepId: 's1', description: SPOKEN }]);
    await updateStepDescription('s1', 'Click Billing', 'manual');

    expect(await restoreNarratedDescription('s1')).toBe(SPOKEN);

    const step = await db.steps.get('s1');
    expect(step?.description).toBe(SPOKEN);
    expect(step?.descriptionSource).toBe('narration');
  });

  it('has nothing to put back on a step narration never touched', async () => {
    expect(await restoreNarratedDescription('s1')).toBeNull();
    expect((await db.steps.get('s1'))?.description).toBe('Clicked Billing');
  });
});

describe('appendToStepDescription', () => {
  it('adds a recovered line to what the step already says', async () => {
    expect(await appendToStepDescription('s1', 'then confirm the change')).toBe(
      'Clicked Billing then confirm the change',
    );
    expect((await db.steps.get('s1'))?.descriptionSource).toBe('manual');
  });

  it('becomes the whole description when the step had none', async () => {
    await db.steps.update('s1', { description: '' });
    expect(await appendToStepDescription('s1', 'open the billing tab')).toBe('open the billing tab');
  });

  it('refuses blank text and a step that is gone', async () => {
    expect(await appendToStepDescription('s1', '   ')).toBeNull();
    expect(await appendToStepDescription('missing', 'anything')).toBeNull();
  });
});

describe('stored transcripts', () => {
  const transcript = {
    epochMs: 1_700_000_000_000,
    lines: [
      { start: 1, end: 3, text: SPOKEN, stepId: 's1', rejectReason: null },
      { start: 4, end: 5, text: 'you', stepId: null, rejectReason: 'solo-filler:you' },
    ],
  };

  it('keeps every line, attributed or not', async () => {
    await saveTranscript('g1', transcript);

    const rows = await getTranscripts('g1');
    expect(rows).toHaveLength(1);
    expect(rows[0].lines).toHaveLength(2);
    expect(await hasTranscript('g1')).toBe(true);
  });

  it('stores nothing when there was nothing to say', async () => {
    await saveTranscript('g1', { epochMs: 0, lines: [] });
    expect(await hasTranscript('g1')).toBe(false);
  });

  it('keeps each transcribed slice as its own row', async () => {
    await saveTranscript('g1', transcript);
    await saveTranscript('g1', { ...transcript, epochMs: transcript.epochMs + 30_000 });
    expect(await getTranscripts('g1')).toHaveLength(2);
  });

  it('can be deleted on its own, leaving the guide alone', async () => {
    await saveTranscript('g1', transcript);
    await deleteTranscripts('g1');

    expect(await hasTranscript('g1')).toBe(false);
    expect(await db.steps.get('s1')).toBeDefined();
  });

  it('goes away with the guide', async () => {
    await saveTranscript('g1', transcript);
    await permanentlyDeleteGuide('g1');

    expect(await db.transcripts.count()).toBe(0);
  });
});

describe('a transcript whose guide is no longer there', () => {
  const transcript = {
    epochMs: 1_700_000_000_000,
    lines: [{ start: 1, end: 3, text: SPOKEN, stepId: 's1', rejectReason: null }],
  };

  it('follows its steps when a staged recording is merged into another guide', async () => {
    await db.guides.add({
      id: 'target',
      title: 'Target',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stepIds: [],
      starred: false,
      deletedAt: null,
    });
    await saveTranscript('g1', transcript);

    await mergeGuideInto('g1', 'target', 0);

    expect(await hasTranscript('g1')).toBe(false);
    expect(await hasTranscript('target')).toBe(true);
  });

  it('is filed against the guide the steps ended up on when it lands after the merge', async () => {
    await db.guides.add({
      id: 'target',
      title: 'Target',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stepIds: [],
      starred: false,
      deletedAt: null,
    });
    await mergeGuideInto('g1', 'target', 0);

    await saveTranscript('g1', transcript);

    expect(await hasTranscript('target')).toBe(true);
    expect((await getTranscripts('target'))[0].guideId).toBe('target');
  });

  it('still finds the merged guide when nothing in the slice was attributed', async () => {
    await db.guides.add({
      id: 'target',
      title: 'Target',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stepIds: [],
      starred: false,
      deletedAt: null,
    });
    await mergeGuideInto('g1', 'target', 0);

    await saveTranscript('g1', {
      epochMs: 1_700_000_000_000,
      lines: [{ start: 1, end: 3, text: 'thinking out loud', stepId: null, rejectReason: null }],
    });

    expect(await hasTranscript('target')).toBe(true);
  });

  it('is not written at all once the guide and its steps are gone', async () => {
    await permanentlyDeleteGuide('g1');

    await saveTranscript('g1', transcript);

    expect(await db.transcripts.count()).toBe(0);
  });
});

describe('deleting a transcript', () => {
  const transcript = {
    epochMs: 1_700_000_000_000,
    lines: [{ start: 1, end: 3, text: SPOKEN, stepId: 's1', rejectReason: null }],
  };

  it('takes the spoken words off the steps too, so nothing can put them back', async () => {
    await applyNarrationToSteps([{ stepId: 's1', description: SPOKEN }]);
    await saveTranscript('g1', transcript);

    await deleteTranscripts('g1');

    expect((await db.steps.get('s1'))?.narratedDescription).toBeUndefined();
    expect(await restoreNarratedDescription('s1')).toBeNull();
  });

  it('takes them out of the snapshots that copied them', async () => {
    await applyNarrationToSteps([{ stepId: 's1', description: SPOKEN }]);
    await createSnapshot('g1');
    await saveTranscript('g1', transcript);

    await deleteTranscripts('g1');

    const snapshots = await db.snapshots.where('guideId').equals('g1').toArray();
    expect(snapshots.flatMap((s) => s.steps).every((s) => s.narratedDescription === undefined)).toBe(true);
  });
});

describe('a line pushed onto a step by hand', () => {
  const transcript = {
    epochMs: 1_700_000_000_000,
    lines: [
      { start: 1, end: 3, text: SPOKEN, stepId: 's1', rejectReason: null },
      { start: 4, end: 6, text: 'and then confirm it', stepId: null, rejectReason: null },
    ],
  };

  it('goes back to unused when the step is restored to what narration said', async () => {
    await applyNarrationToSteps([{ stepId: 's1', description: SPOKEN }]);
    await saveTranscript('g1', transcript);
    const row = (await getTranscripts('g1'))[0];

    await appendToStepDescription('s1', 'and then confirm it');
    await attachTranscriptLine(row.id, 1, 's1');
    expect((await getTranscripts('g1'))[0].lines[1]).toMatchObject({ stepId: 's1', addedByHand: true });

    await restoreNarratedDescription('s1');

    const after = (await getTranscripts('g1'))[0].lines[1];
    expect(after.stepId).toBeNull();
    expect(after.addedByHand).toBeUndefined();
  });

  it('leaves a line narration itself attributed alone', async () => {
    await applyNarrationToSteps([{ stepId: 's1', description: SPOKEN }]);
    await saveTranscript('g1', transcript);
    await updateStepDescription('s1', 'Click Billing', 'manual');

    await restoreNarratedDescription('s1');

    expect((await getTranscripts('g1'))[0].lines[0].stepId).toBe('s1');
  });
});

describe('the snapshot hash after the spoken text is stripped', () => {
  it('is recomputed, so two identical saves still collapse into one version', async () => {
    await applyNarrationToSteps([{ stepId: 's1', description: SPOKEN }]);
    const before = await createSnapshot('g1');
    await saveTranscript('g1', {
      epochMs: 1_700_000_000_000,
      lines: [{ start: 1, end: 3, text: SPOKEN, stepId: 's1', rejectReason: null }],
    });

    await deleteTranscripts('g1');
    const after = await createSnapshot('g1');

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    const stored = await db.snapshots.get((before as { id: string }).id);
    expect(stored?.contentHash).toBe((after as { contentHash: string }).contentHash);
  });
});

describe('restoring an older version', () => {
  it('keeps a spoken original the snapshot was taken too early to hold', async () => {
    const snapshot = await createSnapshot('g1');
    expect(snapshot).not.toBeNull();

    await applyNarrationToSteps([{ stepId: 's1', description: SPOKEN }]);
    await revertToSnapshot((snapshot as { id: string }).id);

    expect((await db.steps.get('s1'))?.narratedDescription).toBe(SPOKEN);
  });
});
