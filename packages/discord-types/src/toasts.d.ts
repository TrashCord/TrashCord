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

export function showToast(data: ToastData): void;
export function showToast(message: string, type?: ToastType, options?: ToastOptions): void;

export interface Toasts {
    show: (data: ToastData) => void;
    pop: (context?: string) => void;
}
