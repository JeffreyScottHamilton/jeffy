import { cn } from "@/lib/utils";

/** Animated height collapse (grid 0fr -> 1fr). Closed content is inert so it cannot take focus. */
export function Collapse({
  open,
  id,
  className,
  children,
}: {
  open: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="jeffy-collapse" data-open={open} inert={!open}>
      <div className={cn(className)}>{children}</div>
    </div>
  );
}
