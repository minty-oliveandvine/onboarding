// The two affordances every step renders at its foot: "Save and Exit", and the
// Back / Save-and-Next pair. Extracted verbatim from OnboardingSteps.
//
// StepSelectModule deliberately does NOT use StepNav -- its footer has different disabled
// logic and an extra hint node, so sharing would parameterise more than it saves. That was a
// considered decision in the first cleanse; do not "finish the job" by folding it in.

import { useState, type CSSProperties } from 'react';
import Icon from '../Icon';
import type { StepProps, SubmitFn } from '../../lib/types';

type SaveExitLinkProps = {
  saveAndExit: StepProps['saveAndExit'];
  /** The step's own save. Optional: two steps have nothing of their own to persist. */
  submitFn?: SubmitFn;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function SaveExitLink({
  saveAndExit,
  submitFn,
  disabled = false,
  className = 'btn-link-center',
  style,
}: SaveExitLinkProps) {
  const [exiting, setExiting] = useState(false);
  const onClick = async () => {
    if (exiting || disabled) return;
    setExiting(true);
    try {
      await saveAndExit(submitFn);
    } catch {
      setExiting(false); // saveAndExit redirects on success, so we only land here on failure
    }
  };
  return (
    <button
      type="button"
      className={className}
      style={style}
      disabled={disabled || exiting}
      onClick={onClick}
    >
      {exiting ? 'Saving…' : 'Save & Exit'}
    </button>
  );
}

// Back / Save & Exit / Save & Next footer shared by the Account Code, Others,
// Bills and Sales sub-steps. `isLastContentStep` is only passed by the steps
// that can be last — when it is undefined the ternary falls through to
// "Save & Next", which is exactly what those steps rendered before.
//
// StepSelectModule deliberately does NOT use this: its primary button has
// different disabled logic and an extra sibling hint, so sharing would mean
// parameterizing more than it saves.
type StepNavProps = {
  back: () => void;
  saveAndExit: StepProps['saveAndExit'];
  stepSubmit?: SubmitFn;
  tryNext: () => void;
  saving: boolean;
  /** Only the steps that can be last pass this; undefined falls through to "Save & Next". */
  isLastContentStep?: boolean;
};

export function StepNav({
  back,
  saveAndExit,
  stepSubmit,
  tryNext,
  saving,
  isLastContentStep,
}: StepNavProps) {
  return (
    <div className="step-nav">
      <button className="btn btn-ghost" onClick={back}>
        <Icon.ArrowLeft /> Back
      </button>
      <div className="step-actions">
        <SaveExitLink saveAndExit={saveAndExit} submitFn={stepSubmit} disabled={saving} />
        <button className="btn btn-primary" onClick={tryNext} disabled={saving}>
          {saving ? (
            'Saving…'
          ) : isLastContentStep ? (
            'Complete'
          ) : (
            <>
              Save &amp; Next <Icon.Arrow />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// --- Step 1: Create Entity ---
