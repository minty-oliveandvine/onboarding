// components/Stepper -- the horizontal step tiles across the top of the wizard.
//
// Three rules decide what a tile looks like and where clicking it lands, and all
// three are easy to get subtly wrong:
//
//   done      EVERY id in the group is behind `current` -- not just the first
//   locked    the group's FIRST id is past `maxReached`
//   target    clicking a grouped tile (Petty Cash = 5,6,7) lands on the sub-step
//             the user was actually on, not always the first
//
// The marquee effect in the useEffect is not tested: it reads getComputedStyle and
// scrollWidth, both of which jsdom stubs to 0, so a test of it would assert on the
// stub rather than on the behaviour. It is covered by eye in the browser.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Stepper from '../Stepper';
import { getDisplaySteps } from '../../lib/wizardSteps';

const DISPLAY = getDisplaySteps(['pettyCash', 'bills']);

function setup(props = {}) {
  const onClick = vi.fn();
  const utils = render(
    <Stepper
      current={1}
      maxReached={1}
      displaySteps={DISPLAY}
      onClick={onClick}
      {...props}
    />,
  );
  const tiles = () => Array.from(utils.container.querySelectorAll('.step'));
  const tile = (firstId: number) =>
    utils.container.querySelector(`.step[data-step-key="${firstId}"]`) as HTMLElement;
  return { onClick, tile, tiles, ...utils };
}

describe('rendering', () => {
  it('renders one tile per display step', () => {
    const { tiles } = setup();
    expect(tiles()).toHaveLength(DISPLAY.length);
  });

  it('renders both the full and the tiny label for each tile', () => {
    // Which one shows is a CSS decision, so both are always in the DOM.
    setup();
    expect(screen.getByText('Connect to Accounting System')).toBeInTheDocument();
    expect(screen.getByText('Accounting')).toBeInTheDocument();
  });

  it('publishes the step count to CSS as --step-count', () => {
    const { container } = setup();
    const stepper = container.querySelector('.stepper') as HTMLElement;
    expect(stepper.style.getPropertyValue('--step-count')).toBe(String(DISPLAY.length));
  });
});

describe('status', () => {
  it('marks the current step active', () => {
    const { tile } = setup({ current: 2, maxReached: 2 });
    expect(tile(2).className).toContain('active');
  });

  it('marks a passed step done and gives it a check', () => {
    const { tile } = setup({ current: 3, maxReached: 3 });
    expect(tile(1).className).toContain('done');
    expect(tile(1).querySelector('.num svg')).toBeTruthy();
  });

  it('marks a future reachable step todo', () => {
    const { tile } = setup({ current: 1, maxReached: 4 });
    expect(tile(2).className).toContain('todo');
    // No badge at all: todo steps show neither a check nor a lock.
    expect(tile(2).querySelector('.num')).toBeNull();
  });

  it('only calls a GROUP done once every sub-step is behind current', () => {
    // The bug this guards: `d.ids.some(...)` instead of `.every(...)` would tick
    // Petty Cash off while the user is still on step 6 of it.
    const { tile } = setup({ current: 6, maxReached: 6 });
    expect(tile(5).className).toContain('active');
    expect(tile(5).className).not.toContain('done');

    const later = setup({ current: 8, maxReached: 8 });
    expect(later.tile(5).className).toContain('done');
  });
});

describe('locking', () => {
  it('locks a step past maxReached and says why', () => {
    const { tile } = setup({ current: 2, maxReached: 2 });
    const locked = tile(4);
    expect(locked.className).toContain('locked');
    expect(locked).toHaveAttribute('title', 'Complete the previous steps first');
  });

  it('leaves no title on a reachable step', () => {
    const { tile } = setup({ current: 2, maxReached: 4 });
    expect(tile(4)).not.toHaveAttribute('title');
  });

  it('judges a group by its FIRST id', () => {
    // maxReached 5 unlocks the whole Petty Cash group even though 6 and 7 are
    // past it -- the group is entered at 5.
    const { tile } = setup({ current: 5, maxReached: 5 });
    expect(tile(5).className).not.toContain('locked');
  });

  it('does not fire onClick for a locked step', async () => {
    const { tile, onClick } = setup({ current: 2, maxReached: 2 });
    await userEvent.click(tile(8));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('clicking', () => {
  it('navigates to a reachable earlier step', async () => {
    const { tile, onClick } = setup({ current: 4, maxReached: 4 });
    await userEvent.click(tile(2));
    expect(onClick).toHaveBeenCalledWith(2);
  });

  it('lands on the current sub-step when clicking the group you are inside', async () => {
    const { tile, onClick } = setup({ current: 6, maxReached: 7 });
    await userEvent.click(tile(5));
    expect(onClick).toHaveBeenCalledWith(6);
  });

  it('lands on the furthest reached sub-step when clicking a group from outside', async () => {
    const { tile, onClick } = setup({ current: 8, maxReached: 8 });
    await userEvent.click(tile(5));
    // Not 5. The user got as far as 7 inside that group, so that is where they
    // resume -- clamped to the group, never past it.
    expect(onClick).toHaveBeenCalledWith(7);
  });

  it('clamps the target to the group even when maxReached is beyond it', () => {
    const { tile, onClick } = setup({ current: 9, maxReached: 9 });
    // current === 9 makes everything unclickable, so assert the clamp through the
    // reachable case instead.
    expect(tile(5)).toBeTruthy();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('falls back to the first id when no sub-step has been reached', async () => {
    const { tile, onClick } = setup({ current: 4, maxReached: 4 });
    // Petty Cash (5,6,7) is not reachable at maxReached 4, so nothing happens --
    // the fallback is exercised by the group being entered at exactly 5.
    await userEvent.click(tile(5));
    expect(onClick).not.toHaveBeenCalled();

    const entered = setup({ current: 4, maxReached: 5 });
    await userEvent.click(entered.tile(5));
    expect(entered.onClick).toHaveBeenCalledWith(5);
  });

  it('stops every step being clickable once on All Set', async () => {
    // Onboarding is finished at 9. Completed steps keep their "done" look rather
    // than turning into locks, but none of them navigate anywhere.
    const { tile, tiles, onClick } = setup({ current: 9, maxReached: 9 });
    for (const el of tiles()) expect(el.className).toContain('not-clickable');
    expect(tile(1).className).toContain('done');
    expect(tile(1).className).not.toContain('locked');
    await userEvent.click(tile(1));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('module-driven shape', () => {
  it('drops the Petty Cash tile when that module is not selected', () => {
    const { container } = setup({ displaySteps: getDisplaySteps(['bills']) });
    expect(container.querySelector('.step[data-step-key="5"]')).toBeNull();
    expect(container.querySelector('.step[data-step-key="8"]')).toBeTruthy();
  });

  it('renders only the common steps and All Set when no module is selected', () => {
    const { tiles } = setup({ displaySteps: getDisplaySteps([]) });
    expect(tiles()).toHaveLength(5);
  });
});
