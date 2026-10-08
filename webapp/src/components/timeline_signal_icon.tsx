import { SatelliteDish } from "lucide-react";
import React from "react";

type Props = {
  readonly size: number;
  readonly label?: string;
  readonly children?: React.ReactNode;
};

export function TimelineSignalIcon({ size, label, children }: Props) {
  return (
    <SatelliteDish
      size={size}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined}
      focusable="false"
    >
      {children}
    </SatelliteDish>
  );
}
