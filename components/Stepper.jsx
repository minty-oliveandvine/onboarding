// The horizontal step tiles across the top of the wizard. Extracted verbatim from
// OnboardingApp -- presentational, no state of its own beyond the overflow measurement.
//
// The label marquee is the only non-obvious part: a tile whose text overflows gets an
// `is-overflow` class and a `--scroll-end` custom property, remeasured on resize, so the CSS
// can scroll it rather than truncating a step name to something unreadable.

import { useEffect, useRef } from 'react';
import Icon from './Icon';

export default function Stepper({ current, onClick, maxReached, displaySteps }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const check = () => {
      ref.current.querySelectorAll('.step .label').forEach((label) => {
        if (getComputedStyle(label).display === 'none') return;
        const inner = label.querySelector('.label-inner');
        if (!inner) return;
        const overflow = inner.scrollWidth - label.clientWidth;
        if (overflow > 1) {
          label.classList.add('is-overflow');
          inner.style.setProperty('--scroll-end', -overflow - 8 + 'px');
        } else {
          label.classList.remove('is-overflow');
          inner.style.removeProperty('--scroll-end');
        }
      });
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(ref.current);
    window.addEventListener('resize', check);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [current, maxReached]);

  return (
    <div className="stepper" ref={ref} data-screen-label="Stepper" style={{ '--step-count': displaySteps.length }}>
      {displaySteps.map((d) => {
        const isActive = d.ids.includes(current);
        const isDone = d.ids.every((i) => current > i);
        const status = isDone ? 'done' : isActive ? 'active' : 'todo';
        const firstId = d.ids[0];
        const reachable = firstId <= maxReached;
        // Once on "All Set" (9), onboarding is finished — no step is clickable
        // anymore, but completed steps keep their "done" look (not the lock).
        const clickable = reachable && current !== 9;
        // For a grouped tile (e.g. Petty Cash = steps 5,6,7), land on the
        // sub-step the user was actually on rather than always the first: the
        // current sub-step if we're inside the group, otherwise the furthest
        // reached sub-step (clamped to the group), falling back to firstId.
        const targetId = d.ids.includes(current)
          ? current
          : (d.ids.filter((i) => i <= maxReached).pop() ?? firstId);
        return (
          <div
            key={d.ids[0]}
            data-step-key={d.ids[0]}
            className={'step ' + status + (reachable ? '' : ' locked') + (clickable ? '' : ' not-clickable')}
            onClick={() => clickable && onClick(targetId)}
            title={reachable ? undefined : 'Complete the previous steps first'}
          >
            {(isDone || !reachable) && <span className="num">{isDone ? <Icon.Check /> : <Icon.Lock />}</span>}
            <span className="label label-full">
              <span className="label-inner">{d.label}</span>
            </span>
            <span className="label label-tiny">
              <span className="label-inner">{d.tiny}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
