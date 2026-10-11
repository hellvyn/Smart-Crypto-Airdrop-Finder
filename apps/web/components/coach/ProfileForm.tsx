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

/** A group of radio buttons under one legend, with its error message below. */
function Radios({
  name,
  legend,
  options,
  value,
  error,
  onChange,
  children,
}: {
  name: string;
  legend: string;
  options: readonly (readonly [string, string])[];
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <fieldset className="coach-field">
      <legend>{legend}</legend>
      <div className="coach-options">
        {options.map(([optionValue, label]) => (
          <label key={optionValue} className="coach-option">
            <input type="radio" name={name} value={optionValue} checked={value === optionValue} onChange={() => onChange(optionValue)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {children}
      {error ? <p className="form-error">{error}</p> : null}
    </fieldset>
  );
}

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
      <Radios name="level" legend={copy.level.legend} options={LEVELS} value={values.level} error={errors.level} onChange={(v) => set("level", v)} />
      <Radios
        name="capital_band"
        legend={copy.capital.legend}
        options={CAPITALS}
        value={values.capital_band}
        error={errors.capital_band}
        onChange={(v) => set("capital_band", v)}
      >
        {values.level === "beginner" ? <p className="muted coach-hint">{copy.capital.beginnerHint}</p> : null}
      </Radios>
      <Radios
        name="has_wallet"
        legend={copy.wallet.legend}
        options={[
          ["yes", copy.wallet.yes],
          ["no", copy.wallet.no],
        ]}
        value={values.has_wallet}
        error={errors.has_wallet}
        onChange={(v) => setValues((prev) => ({ ...prev, has_wallet: v as ProfileFormValues["has_wallet"] }))}
      />
      {values.has_wallet === "yes" ? (
        <div className="coach-field">
          <label htmlFor="coach-wallet-count">{copy.wallet.count}</label>
          <input
            id="coach-wallet-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            step={1}
            value={values.wallet_count}
            onChange={(e) => set("wallet_count", e.target.value)}
          />
          {errors.wallet_count ? <p className="form-error">{errors.wallet_count}</p> : null}
        </div>
      ) : null}
      <Radios
        name="minutes_per_day"
        legend={copy.minutes.legend}
        options={MINUTES}
        value={values.minutes_per_day}
        error={errors.minutes_per_day}
        onChange={(v) => set("minutes_per_day", v)}
      />
      <Radios name="goal" legend={copy.goal.legend} options={GOALS} value={values.goal} error={errors.goal} onChange={(v) => set("goal", v)} />
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
