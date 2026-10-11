"use client";

import { useState, type FormEvent } from "react";
import type { CoachProfile } from "@saf/core";
import { saveCoachProfileAction } from "@/app/(app)/coach/actions";
import { Button } from "@/components/ui";
import { formValuesFrom, validateProfileForm, type ProfileFormErrors, type ProfileFormValues } from "@/lib/coach-text";
import { coach } from "@/lib/copy";

const copy = coach.form;

const LEVELS = [
  ["beginner", copy.level.beginner],
  ["intermediate", copy.level.intermediate],
  ["pro", copy.level.pro],
] as const;
const CAPITALS = (["free", "gas_only", "up_to_100", "up_to_1000", "over_1000"] as const).map((v) => [v, copy.capital[v]] as const);
const MINUTES = ([15, 30, 60, 120] as const).map((v) => [String(v), copy.minutes[v]] as const);
const GOALS = (["quick", "long_term", "learn"] as const).map((v) => [v, copy.goal[v]] as const);

/** One dropdown with its label above and its error message below; the empty first option means "not chosen yet". */
function Select({
  id,
  label,
  options,
  value,
  error,
  onChange,
  children,
}: {
  id: string;
  label: string;
  options: readonly (readonly [string, string])[];
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="coach-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined}>
        <option value="">{copy.choose}</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
      {children}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

const WALLET_COUNTS = Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)] as const);

/**
 * The Coach profile form (spec §5.1). Checked here for the messages and again on the server before anything is saved.
 * No email, wallet address or balance is asked. `onSaved` gets the profile once the server has stored it.
 */
export function ProfileForm({
  chains,
  initial,
  submitLabel,
  onSaved,
}: {
  chains: string[];
  initial: CoachProfile | null;
  submitLabel: string;
  onSaved: (profile: CoachProfile) => void | Promise<void>;
}) {
  const [values, setValues] = useState<ProfileFormValues>(() => formValuesFrom(initial));
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const checked = validateProfileForm(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      setSaveError(null);
      return;
    }
    setErrors({});
    setSaveError(null);
    setBusy(true);
    try {
      const saved = await saveCoachProfileAction(checked.profile);
      if (!saved.ok) {
        setSaveError(saved.message);
        return;
      }
      await onSaved(checked.profile);
    } catch {
      setSaveError(copy.errors.save);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="coach-form" onSubmit={submit} noValidate>
      <div className="coach-form-grid">
        <Select id="coach-level" label={copy.level.legend} options={LEVELS} value={values.level} error={errors.level} onChange={(v) => set("level", v)} />
        <Select
          id="coach-capital"
          label={copy.capital.legend}
          options={CAPITALS}
          value={values.capital_band}
          error={errors.capital_band}
          onChange={(v) => set("capital_band", v)}
        >
          {values.level === "beginner" ? <p className="muted coach-hint">{copy.capital.beginnerHint}</p> : null}
        </Select>
        <Select
          id="coach-has-wallet"
          label={copy.wallet.legend}
          options={[
            ["yes", copy.wallet.yes],
            ["no", copy.wallet.no],
          ]}
          value={values.has_wallet}
          error={errors.has_wallet}
          onChange={(v) => setValues((prev) => ({ ...prev, has_wallet: v as ProfileFormValues["has_wallet"] }))}
        />
        {values.has_wallet === "yes" ? (
          <Select
            id="coach-wallet-count"
            label={copy.wallet.count}
            options={WALLET_COUNTS}
            value={values.wallet_count}
            error={errors.wallet_count}
            onChange={(v) => set("wallet_count", v)}
          />
        ) : null}
        <Select
          id="coach-minutes"
          label={copy.minutes.legend}
          options={MINUTES}
          value={values.minutes_per_day}
          error={errors.minutes_per_day}
          onChange={(v) => set("minutes_per_day", v)}
        />
        <Select id="coach-goal" label={copy.goal.legend} options={GOALS} value={values.goal} error={errors.goal} onChange={(v) => set("goal", v)} />
      </div>
      {chains.length > 0 ? (
        <fieldset className="coach-field">
          <legend>{copy.chains.legend}</legend>
          <div className="coach-options">
            {chains.map((chain) => (
              <label key={chain} className="coach-option">
                <input
                  type="checkbox"
                  value={chain}
                  checked={values.chains.includes(chain)}
                  onChange={(e) => set("chains", e.target.checked ? [...values.chains, chain].slice(0, 10) : values.chains.filter((c) => c !== chain))}
                />
                <span>{chain}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <p className="muted">{copy.privacy}</p>
      {saveError ? (
        <p role="alert" className="form-error">
          {saveError}
        </p>
      ) : null}
      <Button variant="primary" type="submit" disabled={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
