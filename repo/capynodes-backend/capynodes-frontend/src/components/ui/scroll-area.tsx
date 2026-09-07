import * as React from "react";
import { cn } from "@/lib/cn";

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
    orientation?: "vertical" | "horizontal" | "both";
}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
    ({ className, orientation = "vertical", children, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn(
                    "relative",
                    orientation === "vertical" && "overflow-y-auto overflow-x-hidden",
                    orientation === "horizontal" && "overflow-x-auto overflow-y-hidden",
                    orientation === "both" && "overflow-auto",
                    "scrollbar-thin",
                    className
                )}
                {...props}
            >
                {children}
            </div>
        );
    }
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
