// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const duplicateGuide = vi.fn();
const navigate = vi.fn();

vi.mock('@/core/guides/service', () => ({
  createSnapshot: vi.fn().mockResolvedValue(null),
  duplicateGuide: (...args: unknown[]) => duplicateGuide(...args),
}));

vi.mock('../router', () => ({
  navigate: (...args: unknown[]) => navigate(...args),
}));

vi.mock('../ExportPreviewModal', () => ({ default: () => null }));

const storeState = {
  counts: { all: 1, starred: 0, trash: 0 },
  guideTitle: 'LONG ORIGINAL',
  guideStepCount: 12,
  guideExportData: { guideId: 'g1', guide: {}, steps: [], screenshots: new Map() },
  setSearchOpen: vi.fn(),
  editing: false,
  setEditing: vi.fn(),
  historyOpen: false,
  setHistoryOpen: vi.fn(),
  bumpHistoryRefresh: vi.fn(),
  transcriptOpen: false,
  setTranscriptOpen: vi.fn(),
  hasTranscript: false,
};

vi.mock('@/stores/fullview', () => ({
  useFullview: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

import TopNav from '../TopNav';

const route = { page: 'guide', guideId: 'g1' } as const;

function duplicateButton(): HTMLButtonElement {
  const btn = screen.getAllByRole('button').find((b) => /duplicat|duplicar|副本|dupliz/i.test(b.textContent ?? ''));
  if (!btn) throw new Error('Duplicate button not rendered');
  return btn as HTMLButtonElement;
}

/** Lets the awaited duplicateGuide() resolve and React flush its state update. */
async function settleMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  duplicateGuide.mockReset().mockResolvedValue('copy-1');
  navigate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TopNav duplicate', () => {
  it('navigates into the copy it just made', async () => {
    render(<TopNav route={route} />);

    fireEvent.click(duplicateButton());
    await settleMicrotasks();

    expect(duplicateGuide).toHaveBeenCalledWith('g1');
    expect(navigate).toHaveBeenCalledWith({ page: 'guide', guideId: 'copy-1' });
  });

  it('makes one copy from a fast multi-click, not a chain of copies of copies', async () => {
    render(<TopNav route={route} />);

    // The first click navigates to the copy in a couple of milliseconds. Without a guard that
    // outlives the navigation, the later clicks land on the copy's own Duplicate button and fork
    // it again, so a triple-click leaves "Copy of Copy of Copy of ..." behind.
    fireEvent.click(duplicateButton());
    await settleMicrotasks();
    fireEvent.click(duplicateButton());
    fireEvent.click(duplicateButton());
    await settleMicrotasks();

    expect(duplicateGuide).toHaveBeenCalledTimes(1);
  });

  it('keeps the button disabled across the navigation, then releases it', async () => {
    render(<TopNav route={route} />);

    fireEvent.click(duplicateButton());
    await settleMicrotasks();
    expect(duplicateButton().disabled).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(duplicateButton().disabled).toBe(false);

    fireEvent.click(duplicateButton());
    await settleMicrotasks();
    expect(duplicateGuide).toHaveBeenCalledTimes(2);
  });

  it('re-enables immediately when the copy could not be made', async () => {
    duplicateGuide.mockRejectedValue(new Error('boom'));
    render(<TopNav route={route} />);

    fireEvent.click(duplicateButton());
    await settleMicrotasks();

    expect(navigate).not.toHaveBeenCalled();
    expect(duplicateButton().disabled).toBe(false);
  });
});
