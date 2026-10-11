import { list } from "@/lib/copy";

/**
 * A multi-choice filter as a dropdown (owner 2026-10-11: the checkbox rows looked messy). Plain HTML, no script: the
 * <details> opens a menu of checkboxes inside the list's GET form, and the button shows what is ticked ("Semua", the
 * one label, or "{n} dipilih"). The fieldset keeps the legend as the group's accessible name.
 */
export function FilterMenu({
  legend,
  name,
  options,
  picked,
}: {
  legend: string;
  name: string;
  options: readonly (readonly [string, string])[];
  picked: readonly string[];
}) {
  const pickedLabels = options.filter(([value]) => picked.includes(value)).map(([, label]) => label);
  return (
    <div className="filter-field">
      <span className="filter-label" aria-hidden="true">
        {legend}
      </span>
      <details className="filter-menu">
        <summary aria-label={`${legend}: ${list.filterSummary(pickedLabels)}`}>{list.filterSummary(pickedLabels)}</summary>
        <fieldset>
          <legend className="visually-hidden">{legend}</legend>
          {options.map(([value, label]) => (
            <label key={value} className="filter-option">
              <input type="checkbox" name={name} value={value} defaultChecked={picked.includes(value)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      </details>
    </div>
  );
}
