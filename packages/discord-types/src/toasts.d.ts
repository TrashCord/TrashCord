import { Toasts, ToastType, ToastOptions, ToastData } from "./toasts";

export function showToast(
    arg1: string | ToastData,
    arg2?: ToastType,
    arg3?: ToastOptions
) {
    
    if (typeof arg1 === "string") {
        
        let variant: "default" | "success" | "critical" = "default";
        if (arg2 === "success") variant = "success";
        else if (arg2 === "failure") variant = "critical";
        
        return Toasts.show({
            text: arg1,
            variant: variant,
            ...(arg3 || {}),
        } as ToastData);
    }
    
    return Toasts.show(arg1);
}
