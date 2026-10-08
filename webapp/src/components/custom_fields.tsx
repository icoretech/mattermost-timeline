import React from "react";
import type { EventCustomField } from "../types/timeline";

export function CustomFields({
  fields,
}: {
  readonly fields?: readonly EventCustomField[];
}) {
  if (!fields?.length) return null;

  return (
    <dl className="timeline-entry__custom-fields">
      {fields.map((field) => (
        <React.Fragment key={field.name}>
          <dt>{field.label || field.name}</dt>
          <dd>{String(field.value)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
