import { cn } from "@/lib/utils";

export const Skeleton = ({ className }: { className?: string }) => (
  <div
    className={cn("animate-pulse rounded-md bg-raised", className)}
    aria-hidden
  />
);

export const SkeletonText = ({
  lines = 1,
  className,
}: {
  lines?: number;
  className?: string;
}) => (
  <div className={cn("flex flex-col gap-1.5", className)} aria-hidden>
    {Array.from({ length: lines }, (_, index) => (
      <Skeleton
        key={index}
        className={cn("h-3", index === lines - 1 ? "w-2/3" : "w-full")}
      />
    ))}
  </div>
);

export const SkeletonMessage = ({
  align = "start",
}: {
  align?: "start" | "end";
}) => (
  <div
    className={cn(
      "flex w-3/5 flex-col gap-2 rounded-lg bg-panel px-3 py-2.5",
      align === "end" ? "self-end" : "self-start",
    )}
    aria-hidden
  >
    <Skeleton className="h-2.5 w-14" />
    <SkeletonText lines={2} />
  </div>
);

export const SkeletonTimelineRow = () => (
  <div className="flex items-center gap-2 px-3 py-1.5" aria-hidden>
    <Skeleton className="h-3 w-8" />
    <Skeleton className="size-3.5 rounded-full" />
    <Skeleton className="h-3 flex-1" />
    <Skeleton className="h-3 w-10" />
  </div>
);
