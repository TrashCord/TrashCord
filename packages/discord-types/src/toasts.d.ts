import type { ComponentType } from "react";

export type ToastType = "message" | "success" | "failure" | "custom" | "clip" | "link" | "forward" | "bookmark" | "clock";

export type ToastVariant = "default" | "success" | "critical";
export type ToastPosition = "top" | "bottom";

export interface ToastOptions {
    position?: ToastPosition;
    duration?: number;
}

export interface ToastData {
    text: string;
    variant: ToastVariant;
    position?: ToastPosition;
    duration?: number;
    
    icon?: ComponentType;
    iconColor?: any;
}

/* export type showToast = (data: ToastData) => void; */

export interface ShowToastFn {
    (data: ToastData): void;
    (message: string, type?: ToastType, options?: ToastOptions): void;
}

export const showToast: ShowToastFn;

export interface Toasts {
    show: ShowToastFn;
    pop: (context?: string) => void;
}
