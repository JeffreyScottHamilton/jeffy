// Vendored from prompt-kit (https://github.com/ibelick/prompt-kit, MIT, commit 5a94966).
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
