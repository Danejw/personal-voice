//! Opt-in accessibility event stream, without recording text, passwords, screenshots or audio.
//! An OUTOFCONTEXT Windows accessibility hook forwards only categories and active window names.
//! No process-wide hook exists until the user starts monitoring; Stop removes the hook.
use std::sync::{atomic::{AtomicBool,Ordering}, mpsc::{self,Sender}, Mutex,OnceLock};
use std::thread::{self,JoinHandle};
use std::time::{Duration,Instant};
use tauri::{AppHandle,Emitter,Manager,PhysicalPosition,PhysicalSize};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{SetWinEventHook,UnhookWinEvent,HWINEVENTHOOK,
    WINEVENT_OUTOFCONTEXT,WINEVENT_SKIPOWNPROCESS};
use windows::Win32::UI::WindowsAndMessaging::{PeekMessageW,TranslateMessage,DispatchMessageW,MSG,PM_REMOVE};
use super::windows_info::foreground_window_title;

static RUNNING:AtomicBool=AtomicBool::new(false);
static SENDER:OnceLock<Mutex<Option<Sender<u32>>>>=OnceLock::new();
static WORKER:Mutex<Option<JoinHandle<()>>>=Mutex::new(None);

unsafe extern "system" fn event_callback(
    _hook:HWINEVENTHOOK,event:u32,_window:HWND,_object:i32,_child:i32,_thread:u32,_when:u32
){
    // Filter the system-wide WinEvent range before emitting anything to the app.
    if !matches!(event,0x0003|0x8002|0x8003|0x8004|0x8005|0x8006|0x8007|0x8008|0x800A|0x800B|0x800C|0x800E) {
        return;
    }
    if let Some(sender)=SENDER.get(){
        if let Ok(guard)=sender.try_lock(){
            if let Some(tx)=guard.as_ref(){let _=tx.send(event);}
        }
    }
}
fn event_name(id:u32)->&'static str{
    match id {0x0003=>"window",0x8005=>"focus",0x8006|0x8007|0x8008=>"selection",
        0x800E=>"value",0x8002|0x8003|0x8004|0x800A|0x800B|0x800C=>"structure",_=>"change"}
}
pub fn start(app:AppHandle)->Result<String,String>{
    let mut slot=WORKER.lock().map_err(|_|"UIA watcher lock poisoned")?;
    if RUNNING.load(Ordering::SeqCst){return Ok("Accessibility monitoring is already running".into());}
    let (tx,rx)=mpsc::channel();
    let (ready_tx,ready_rx)=mpsc::sync_channel(1);
    *SENDER.get_or_init(||Mutex::new(None)).lock().map_err(|_|"UIA event channel lock poisoned")?=Some(tx);
    RUNNING.store(true,Ordering::SeqCst);
    let handle=thread::spawn(move||{
        let hook=unsafe{SetWinEventHook(0x0003,0x800E,None,Some(event_callback),0,0,
            WINEVENT_OUTOFCONTEXT|WINEVENT_SKIPOWNPROCESS)};
        if hook.0.is_null(){
            RUNNING.store(false,Ordering::SeqCst);
            let _=ready_tx.send(false);
            return;
        }
        let _=ready_tx.send(true);
        let mut previous=Instant::now()-Duration::from_secs(1);
        let mut message=MSG::default();
        while RUNNING.load(Ordering::SeqCst){
            while unsafe{PeekMessageW(&mut message,None,0,0,PM_REMOVE)}.as_bool(){
                unsafe {let _=TranslateMessage(&message);DispatchMessageW(&message);}
            }
            // Coalesce bursts (e.g. typing in an editor) without retaining text.
            let mut newest=None;
            while let Ok(event)=rx.try_recv(){newest=Some(event);}
            if let Some(event)=newest{
                if previous.elapsed()>=Duration::from_millis(180){
                    previous=Instant::now();
                    let kind=event_name(event);
                    let window=foreground_window_title();
                    let _=app.emit_to("main","accessibility-event",serde_json::json!({
                        "kind":kind, "windowTitle":window
                    }));
                    if matches!(kind,"focus"|"window"|"selection") {
                        if let (Some(bounds),Some(highlight))=(super::accessibility_plus::focused_element_bounds(),
                            app.get_webview_window("computer-visual")){
                            let _=highlight.set_ignore_cursor_events(true);
                            let _=highlight.set_position(PhysicalPosition::new(bounds.x,bounds.y));
                            let _=highlight.set_size(PhysicalSize::new(bounds.width as u32,bounds.height as u32));
                            let _=highlight.show();
                            let _=app.emit_to("computer-visual","computer-visual-activity",
                                serde_json::json!({"label":"Live UI focus","phase":"inspect"}));
                        }
                    }
                }
            }
            thread::sleep(Duration::from_millis(40));
        }
        unsafe {let _=UnhookWinEvent(hook);}
        if let Some(sender)=SENDER.get(){if let Ok(mut guard)=sender.lock(){*guard=None;}}
    });
    match ready_rx.recv_timeout(Duration::from_secs(3)){
        Ok(true)=>{*slot=Some(handle);Ok("Windows accessibility monitoring started".into())}
        _=>{
            RUNNING.store(false,Ordering::SeqCst);
            let _=handle.join();
            Err("Windows could not register the accessibility event hook".into())
        }
    }
}
pub fn stop()->Result<String,String>{
    RUNNING.store(false,Ordering::SeqCst);
    let handle=WORKER.lock().map_err(|_|"UIA watcher lock poisoned")?.take();
    if let Some(handle)=handle{let _=handle.join();}
    Ok("Windows accessibility monitoring stopped".into())
}
pub fn active()->bool{RUNNING.load(Ordering::SeqCst)}
