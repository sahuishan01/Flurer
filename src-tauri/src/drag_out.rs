// Toggles WebView2's own inbound file-drop handling around a native
// outbound row-drag (see dnd.ts's startRowDrag). Flurer registers its own
// OS-level drag source for dragging rows out to Explorer/other apps
// (tauri-plugin-drag's DoDragDrop) while *also* keeping Tauri's built-in
// dragDropEnabled on so Explorer→Flurer drag-in keeps working
// (FileList.tsx's onDragDropEvent). With WebView2's own drop target still
// registered on the window while an outbound OS drag is in flight, other
// top-level windows (a browser tab, Teams) never see a drag-enter for it —
// disabling WebView2's external-drop handling for the duration of the
// drag, then restoring it once the drag settles, is the documented
// workaround for that WebView2/Tauri interaction. No-op on non-Windows
// targets, where this conflict doesn't exist.
#[tauri::command]
pub fn set_external_drop_allowed(window: tauri::WebviewWindow, allowed: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller4;
        use windows::core::Interface;

        window
            .with_webview(move |webview| {
                let controller = webview.controller();
                if let Ok(controller4) = controller.cast::<ICoreWebView2Controller4>() {
                    // Safe: WebView2 COM calls confined to the main thread via
                    // with_webview, matching how the rest of the controller
                    // API (e.g. SetZoomFactor) is used elsewhere.
                    let _ = unsafe { controller4.SetAllowExternalDrop(allowed) };
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (window, allowed);
    }
    Ok(())
}
