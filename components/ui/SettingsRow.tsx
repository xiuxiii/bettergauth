"use client";

import { useId, type ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

type Base = {
  icon?: LucideIcon;
  label: string;
  /** One line under the label. */
  description?: string;
};

type ControlRow = Base & {
  /** Rendered with the label's id, for the control's aria-labelledby. */
  control: (labelId: string) => ReactNode;
  /** Always put the control under the label (narrow containers). By default
   *  it moves beside the label from `sm` up. */
  stacked?: boolean;
};

type ValueRow = Base & {
  /** The current value, shown before the chevron. The whole row is a button. */
  value: string;
  onClick: () => void;
  /** Whether the sheet this row opens is open. */
  expanded?: boolean;
};

/**
 * One setting: an optional tinted icon, the label and a one-line description,
 * and either a control or a value + chevron that opens a sheet.
 *
 * Below `sm` a control sits under the label rather than beside it: at 375px a
 * two-segment control beside the label left the label about 60px.
 */
export default function SettingsRow(props: ControlRow | ValueRow) {
  const labelId = useId();
  const { icon: Icon, label, description } = props;

  const text = (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      {Icon && (
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-brand-50 text-brand-700">
          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0">
        <span id={labelId} className="block text-[15px] font-medium leading-5 text-ink">
          {label}
        </span>
        {description && (
          <span className="block truncate text-xs leading-4 text-slate-500">{description}</span>
        )}
      </span>
    </span>
  );

  if ("control" in props) {
    return (
      <div
        className={
          "flex min-h-[52px] flex-col gap-3 px-4 py-3 " +
          (props.stacked ? "" : "sm:flex-row sm:items-center sm:gap-4")
        }
      >
        {text}
        <div className={props.stacked ? "" : "sm:w-auto sm:min-w-[14rem] sm:flex-shrink-0"}>
          {props.control(labelId)}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-haspopup="dialog"
      aria-expanded={props.expanded}
      className="flex min-h-[52px] w-full items-center gap-3 rounded-[inherit] px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
    >
      {text}
      <span className="flex flex-shrink-0 items-center gap-1 text-sm text-slate-500">
        {props.value}
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </span>
    </button>
  );
}
