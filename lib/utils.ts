import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


// Display-time formatting lives in lib/time-format.js (CommonJS) so it is shared
// with the test suite and any non-TypeScript caller.
export const { formatTime12h, formatWindow12h } = require("./time-format.js") as {
  formatTime12h: (hhmm: string) => string;
  formatWindow12h: (start: string, end: string) => string;
};
