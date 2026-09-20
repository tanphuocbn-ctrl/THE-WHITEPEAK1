import { SHOT_STATUS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export const StatusPill = ({ status, className }) => {
  const s = SHOT_STATUS[status] || SHOT_STATUS.todo;
  return (
    <span
      data-testid={`status-pill-${status}`}
      className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", s.cls, className)}
    >
      {s.label}
    </span>
  );
};
