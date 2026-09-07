import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function ProblemsSkeleton() {
  return (
    <div className="min-h-screen bg-background p-6 pt-24">
      <div className="max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-12 w-48 mb-8" />
        
        <Card>
          <div className="overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr className="text-left">
                  <th className="py-3 px-6">
                    <Skeleton className="h-4 w-16" />
                  </th>
                  <th className="py-3 px-6">
                    <Skeleton className="h-4 w-12" />
                  </th>
                  <th className="py-3 px-6">
                    <Skeleton className="h-4 w-20" />
                  </th>
                  <th className="py-3 px-6">
                    <Skeleton className="h-4 w-20" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }).map((_, index) => (
                  <tr
                    key={index}
                    className="border-b border-border last:border-0"
                  >
                    <td className="py-4 px-6">
                      <Skeleton className="w-4 h-4 rounded-full" />
                    </td>
                    <td className="py-4 px-6">
                      <Skeleton className="h-5 w-64" />
                    </td>
                    <td className="py-4 px-6">
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="py-4 px-6">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-48" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-10" />
            <Skeleton className="h-9 w-10" />
            <Skeleton className="h-9 w-10" />
            <Skeleton className="h-9 w-20" />
          </div>
        </div>
      </div>
    </div>
  );
}

