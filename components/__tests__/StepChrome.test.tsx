// components/steps/StepChrome -- the two affordances every step renders at its foot.
//
// The one that matters most is the `isLastContentStep` fall-through. Only the steps
// that CAN be last pass it; for every other step it arrives undefined and the ternary
// falls through to "Save & Next". A truthiness bug there relabels the primary button
// on most of the wizard, and nothing else would notice.
//
// The other is SaveExitLink's catch: `saveAndExit` redirects on success, so the
// component only re-enables itself on FAILURE. Getting that backwards leaves the user
// staring at a permanently disabled "Saving..." after a network error.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SaveExitLink, StepNav } from '../steps/StepChrome';

describe('SaveExitLink', () => {
  it('renders Save & Exit', () => {
    render(<SaveExitLink saveAndExit={vi.fn()} submitFn={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save & Exit' })).toBeEnabled();
  });

  it('passes the step submit function through to saveAndExit', async () => {
    // The step supplies its own submit; SaveExitLink is only the trigger.
    const saveAndExit = vi.fn().mockResolvedValue(undefined);
    const submitFn = vi.fn();
    render(<SaveExitLink saveAndExit={saveAndExit} submitFn={submitFn} />);
    await userEvent.click(screen.getByRole('button'));
    expect(saveAndExit).toHaveBeenCalledExactlyOnceWith(submitFn);
  });

  it('shows Saving... and disables itself while in flight', async () => {
    let release: () => void = () => {};
    const saveAndExit = vi.fn(() => new Promise<void>((r) => { release = r; }));
    render(<SaveExitLink saveAndExit={saveAndExit} submitFn={vi.fn()} />);
    await userEvent.click(screen.getByRole('button'));
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('Saving');
    expect(btn).toBeDisabled();
    release();
  });

  it('stays disabled after a successful save, because saveAndExit redirects', async () => {
    // Re-enabling here would flash "Save & Exit" back in during the redirect.
    const saveAndExit = vi.fn().mockResolvedValue(undefined);
    render(<SaveExitLink saveAndExit={saveAndExit} submitFn={vi.fn()} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('re-enables itself when the save fails', async () => {
    const saveAndExit = vi.fn().mockRejectedValue(new Error('network'));
    render(<SaveExitLink saveAndExit={saveAndExit} submitFn={vi.fn()} />);
    await userEvent.click(screen.getByRole('button'));
    const btn = await screen.findByRole('button', { name: 'Save & Exit' });
    expect(btn).toBeEnabled();
  });

  it('does not fire a second save while one is in flight', async () => {
    const saveAndExit = vi.fn(() => new Promise<void>(() => {}));
    render(<SaveExitLink saveAndExit={saveAndExit} submitFn={vi.fn()} />);
    const btn = screen.getByRole('button');
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(saveAndExit).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when disabled', async () => {
    const saveAndExit = vi.fn();
    render(<SaveExitLink saveAndExit={saveAndExit} submitFn={vi.fn()} disabled />);
    await userEvent.click(screen.getByRole('button'));
    expect(saveAndExit).not.toHaveBeenCalled();
  });

  it('defaults to the centred link class and accepts an override', () => {
    const { container, rerender } = render(
      <SaveExitLink saveAndExit={vi.fn()} submitFn={vi.fn()} />,
    );
    expect(container.querySelector('button')).toHaveClass('btn-link-center');
    rerender(<SaveExitLink saveAndExit={vi.fn()} submitFn={vi.fn()} className="btn-link" />);
    expect(container.querySelector('button')).toHaveClass('btn-link');
  });

  it('is type=button, so it cannot submit a surrounding form', () => {
    render(<SaveExitLink saveAndExit={vi.fn()} submitFn={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

describe('StepNav', () => {
  function setup(props = {}) {
    const back = vi.fn();
    const tryNext = vi.fn();
    const saveAndExit = vi.fn().mockResolvedValue(undefined);
    const stepSubmit = vi.fn();
    const utils = render(
      <StepNav
        back={back}
        tryNext={tryNext}
        saveAndExit={saveAndExit}
        stepSubmit={stepSubmit}
        saving={false}
        {...props}
      />,
    );
    return { back, tryNext, saveAndExit, stepSubmit, ...utils };
  }

  it('renders Back, Save & Exit and the primary button', () => {
    setup();
    expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & Exit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save & Next/ })).toBeInTheDocument();
  });

  describe('the isLastContentStep fall-through', () => {
    it('says Save & Next when the prop is undefined', () => {
      // The steps that cannot be last do not pass it at all. This is the case that
      // covers most of the wizard.
      setup();
      expect(screen.getByRole('button', { name: /Save & Next/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    });

    it('says Save & Next when the prop is explicitly false', () => {
      setup({ isLastContentStep: false });
      expect(screen.getByRole('button', { name: /Save & Next/ })).toBeInTheDocument();
    });

    it('says Complete when the prop is true', () => {
      setup({ isLastContentStep: true });
      expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Save & Next/ })).toBeNull();
    });
  });

  it('calls back and tryNext', async () => {
    const { back, tryNext } = setup();
    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(back).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /Save & Next/ }));
    expect(tryNext).toHaveBeenCalledTimes(1);
  });

  describe('while saving', () => {
    it('relabels the primary button and disables both save paths', async () => {
      const { tryNext, saveAndExit } = setup({ saving: true });
      const primary = screen.getByRole('button', { name: 'Saving…' });
      expect(primary).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Save & Exit' })).toBeDisabled();
      await userEvent.click(primary);
      expect(tryNext).not.toHaveBeenCalled();
      expect(saveAndExit).not.toHaveBeenCalled();
    });

    it('overrides Complete as well as Save & Next', () => {
      setup({ saving: true, isLastContentStep: true });
      expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
    });

    it('leaves Back enabled, so a slow save is not a trap', () => {
      const { back } = setup({ saving: true });
      expect(screen.getByRole('button', { name: /Back/ })).toBeEnabled();
      expect(back).not.toHaveBeenCalled();
    });
  });
});
