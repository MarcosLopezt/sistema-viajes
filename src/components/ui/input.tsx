import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // h-11 (44px) y text-base (16px) en TODOS los breakpoints.
        //
        // El default de shadcn era h-8 con `md:text-sm`, que baja la letra a
        // 14px en escritorio. Se quitó a proposito: 16px es el minimo del
        // documento de requisitos, y ademas cualquier input de menos de 16px
        // hace que iOS Safari haga zoom automatico al enfocarlo, lo que
        // descoloca el formulario del pasajero justo cuando esta escribiendo.
        "h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-base file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
