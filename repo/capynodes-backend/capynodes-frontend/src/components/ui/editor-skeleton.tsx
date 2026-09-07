import { Skeleton } from '@/components/ui/skeleton';

export function EditorSkeleton() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <div className="w-16 border-r border-border bg-card flex flex-col items-center py-4 gap-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="w-10 h-10 rounded-lg" />
        ))}
      </div>

      <div className="flex-1 relative">
        <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
          <Skeleton className="h-10 w-64" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
          </div>
        </div>

        <div className="w-full h-full bg-muted/20 flex items-center justify-center">
          <div className="space-y-4 text-center">
            <Skeleton className="h-8 w-48 mx-auto" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </div>
        </div>
      </div>

      <div className="w-80 border-l border-border bg-card p-4">
        <Skeleton className="h-8 w-32 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>

      <div className="w-80 border-l border-border bg-card p-4">
        <Skeleton className="h-8 w-40 mb-4" />
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

