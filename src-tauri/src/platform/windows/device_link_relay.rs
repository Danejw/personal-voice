//! Local-only DeviceLink WebSocket relay. It never decrypts messages or performs actions.
//! Clients authenticate each other with PR #36 identities and end-to-end AES-GCM.
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

const MAX_CLIENTS: usize = 8;
const MAX_FRAME: usize = 16_384;

struct Relay {
    port: u16,
    online: Arc<AtomicBool>,
}
static SERVER: OnceLock<Mutex<Option<Relay>>> = OnceLock::new();
static NEXT_CLIENT: AtomicU64 = AtomicU64::new(1);
fn state() -> &'static Mutex<Option<Relay>> {
    SERVER.get_or_init(|| Mutex::new(None))
}
fn io_error() -> String { "DeviceLink LAN relay is unavailable.".into() }

#[link(name = "bcrypt")]
extern "system" {
    fn BCryptOpenAlgorithmProvider(out: *mut usize, algorithm: *const u16, implementation: *const u16, flags: u32) -> i32;
    fn BCryptHash(algorithm: usize, secret: *const u8, secret_len: u32, input: *const u8, input_len: u32, digest: *mut u8, digest_len: u32) -> i32;
    fn BCryptCloseAlgorithmProvider(algorithm: usize, flags: u32) -> i32;
}
fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }
fn sha1(bytes: &[u8]) -> Result<[u8; 20], String> {
    let mut handle: usize = 0;
    let status = unsafe { BCryptOpenAlgorithmProvider(&mut handle, wide("SHA1").as_ptr(), std::ptr::null(), 0) };
    if status != 0 { return Err(io_error()); }
    let mut digest = [0u8; 20];
    let result = unsafe {
        BCryptHash(handle, std::ptr::null(), 0, bytes.as_ptr(), bytes.len() as u32, digest.as_mut_ptr(), 20)
    };
    unsafe { BCryptCloseAlgorithmProvider(handle, 0); }
    if result != 0 { return Err(io_error()); }
    Ok(digest)
}
fn standard_base64(bytes: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let a = chunk[0] as usize;
        let b = chunk.get(1).copied().unwrap_or(0) as usize;
        let c = chunk.get(2).copied().unwrap_or(0) as usize;
        out.push(T[a >> 2] as char);
        out.push(T[((a & 3) << 4) | (b >> 4)] as char);
        out.push(if chunk.len() > 1 { T[((b & 15) << 2) | (c >> 6)] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[c & 63] as char } else { '=' });
    }
    out
}
fn private_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => a.is_private() || a.is_loopback() || a.is_link_local(),
        IpAddr::V6(a) => a.is_loopback() || a.is_unique_local() || a.is_unicast_link_local(),
    }
}
fn upgrade(stream: &mut TcpStream) -> Result<(), String> {
    stream.set_read_timeout(Some(Duration::from_secs(4))).map_err(|_| io_error())?;
    let mut request = Vec::new();
    let mut byte = [0u8; 1];
    while request.len() < 4096 {
        stream.read_exact(&mut byte).map_err(|_| io_error())?;
        request.push(byte[0]);
        if request.ends_with(b"\r\n\r\n") { break; }
    }
    if !request.ends_with(b"\r\n\r\n") { return Err(io_error()); }
    let headers = std::str::from_utf8(&request).map_err(|_| io_error())?;
    if !headers.starts_with("GET /device-link HTTP/1.1\r\n") { return Err(io_error()); }
    let mut key = None;
    let mut upgrade = false;
    let mut connection = false;
    let mut version = false;
    for line in headers.split("\r\n").skip(1) {
        if let Some((name, value)) = line.split_once(':') {
            let n = name.trim().to_ascii_lowercase();
            let v = value.trim();
            match n.as_str() {
                "sec-websocket-key" => key = Some(v),
                "upgrade" => upgrade = v.eq_ignore_ascii_case("websocket"),
                "connection" => connection = v.to_ascii_lowercase().split(',').any(|s| s.trim() == "upgrade"),
                "sec-websocket-version" => version = v == "13",
                _ => {}
            }
        }
    }
    let key = key.ok_or_else(io_error)?;
    if !upgrade || !connection || !version || key.len() != 24
        || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=') {
        return Err(io_error());
    }
    let digest = sha1(format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11").as_bytes())?;
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
        standard_base64(&digest),
    );
    stream.write_all(response.as_bytes()).map_err(|_| io_error())?;
    stream.set_read_timeout(Some(Duration::from_millis(750))).map_err(|_| io_error())?;
    Ok(())
}
fn read_frame(stream: &mut TcpStream) -> Result<Option<(u8, Vec<u8>)>, String> {
    let mut header = [0u8; 2];
    match stream.read_exact(&mut header) {
        Ok(()) => {}
        Err(e) if matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => return Ok(None),
        Err(_) => return Err(io_error()),
    }
    if header[0] & 0x80 == 0 || header[0] & 0x70 != 0 || header[1] & 0x80 == 0 {
        return Err(io_error()); // Only final masked client frames are accepted.
    }
    let opcode = header[0] & 0x0F;
    if opcode != 1 && opcode != 8 && opcode != 9 && opcode != 10 { return Err(io_error()); }
    let size = match header[1] & 0x7F {
        n @ 0..=125 => n as usize,
        126 => {
            let mut len = [0u8; 2];
            stream.read_exact(&mut len).map_err(|_| io_error())?;
            u16::from_be_bytes(len) as usize
        }
        127 => return Err(io_error()), // No large frames.
        _ => unreachable!(),
    };
    if size > MAX_FRAME || (opcode != 1 && size > 125) { return Err(io_error()); }
    let mut mask = [0u8; 4];
    stream.read_exact(&mut mask).map_err(|_| io_error())?;
    let mut payload = vec![0u8; size];
    stream.read_exact(&mut payload).map_err(|_| io_error())?;
    for (i, b) in payload.iter_mut().enumerate() { *b ^= mask[i % 4]; }
    Ok(Some((opcode, payload)))
}
fn write_frame(stream: &mut TcpStream, opcode: u8, payload: &[u8]) -> Result<(), String> {
    if payload.len() > MAX_FRAME { return Err(io_error()); }
    let mut header = vec![0x80 | opcode];
    if payload.len() < 126 {
        header.push(payload.len() as u8);
    } else {
        header.push(126);
        header.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    }
    stream.write_all(&header).map_err(|_| io_error())?;
    stream.write_all(payload).map_err(|_| io_error())
}

#[derive(Default)]
struct ClientRegistry {
    clients: HashMap<u64, Sender<String>>,
    names: HashMap<u64, String>,
}
fn participant(frame: &Value) -> Option<(&str, &str)> {
    let row = frame.as_object()?;
    let kind = row.get("kind")?.as_str()?;
    if kind != "hello" && kind != "sealed" { return None; }
    let from = row.get("from")?.as_str()?;
    let to = row.get("target")?.as_str()?;
    if from == to || from.len() != 36 || to.len() != 36 { return None; }
    if !from.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-')
        || !to.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
        return None;
    }
    Some((from, to))
}
fn handle_client(id: u64, mut stream: TcpStream, registry: Arc<Mutex<ClientRegistry>>, online: Arc<AtomicBool>) {
    if upgrade(&mut stream).is_err() { return; }
    let (sender, receiver) = mpsc::channel::<String>();
    {
        let Ok(mut guard) = registry.lock() else { return };
        if guard.clients.len() >= MAX_CLIENTS { return; }
        guard.clients.insert(id, sender);
    }
    let Ok(mut writer) = stream.try_clone() else { return };
    let live = online.clone();
    let writer_thread = thread::spawn(move || {
        while live.load(Ordering::Relaxed) {
            match receiver.recv_timeout(Duration::from_millis(400)) {
                Ok(data) => {
                    if write_frame(&mut writer, 1, data.as_bytes()).is_err() { break; }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        let _ = writer.shutdown(std::net::Shutdown::Both);
    });
    while online.load(Ordering::Relaxed) {
        match read_frame(&mut stream) {
            Ok(None) => continue,
            Ok(Some((8, _))) => break,
            Ok(Some((9, payload))) => {
                // Pong on the writer socket is not safe concurrently; ignore ping,
                // clients send encrypted presence messages instead.
                if payload.len() > 125 { break; }
            }
            Ok(Some((10, _))) => {}
            Ok(Some((1, payload))) => {
                let Ok(text) = std::str::from_utf8(&payload) else { break };
                let Ok(value): Result<Value, _> = serde_json::from_str(text) else { break };
                let Some((from, target)) = participant(&value) else { break };
                let recipients: Vec<Sender<String>>;
                {
                    let Ok(mut guard) = registry.lock() else { break };
                    if let Some(existing) = guard.names.get(&id) {
                        if existing != from { break; }
                    } else {
                        // The peer must still verify the signed hello. This relay's
                        // routing label is never treated as authentication.
                        guard.names.insert(id, from.to_string());
                    }
                    recipients = guard.names.iter().filter(|(other, name)| **other != id && name == target)
                        .filter_map(|(other, _)| guard.clients.get(other).cloned()).collect();
                }
                for outgoing in recipients { let _ = outgoing.send(text.to_string()); }
            }
            Ok(Some(_)) | Err(_) => break,
        }
    }
    if let Ok(mut guard) = registry.lock() {
        guard.clients.remove(&id);
        guard.names.remove(&id);
    }
    let _ = stream.shutdown(std::net::Shutdown::Both);
    let _ = writer_thread.join();
}

/// Start explicitly after a signed-in user has verified at least one pairing.
/// No port forwarding, public interface registration, or unattended auto-launch.
pub fn start() -> Result<u16, String> {
    let mut state = state().lock().map_err(|_| io_error())?;
    if let Some(relay) = state.as_ref() {
        if relay.online.load(Ordering::Relaxed) { return Ok(relay.port); }
    }
    let listener = TcpListener::bind("0.0.0.0:0").map_err(|_| io_error())?;
    listener.set_nonblocking(true).map_err(|_| io_error())?;
    let port = listener.local_addr().map_err(|_| io_error())?.port();
    let online = Arc::new(AtomicBool::new(true));
    let active = online.clone();
    thread::spawn(move || {
        let registry = Arc::new(Mutex::new(ClientRegistry::default()));
        while active.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((socket, peer)) => {
                    if !private_address(peer.ip()) { continue; }
                    let clients = registry.clone();
                    let run = active.clone();
                    let id = NEXT_CLIENT.fetch_add(1, Ordering::Relaxed);
                    thread::spawn(move || handle_client(id, socket, clients, run));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock =>
                    thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }
    });
    *state = Some(Relay { port, online });
    Ok(port)
}

pub fn stop() {
    if let Ok(mut state) = state().lock() {
        if let Some(relay) = state.take() { relay.online.store(false, Ordering::Relaxed); }
    }
}

#[cfg(test)]
mod tests {
    use super::{participant, standard_base64, private_address};
    use serde_json::json;
    #[test]
    fn rfc_websocket_accept_example() {
        assert_eq!(standard_base64(&[0xb3,0x7a,0x4f]), "s3pP");
    }
    #[test]
    fn local_only_and_strict_routes() {
        assert!(private_address("192.168.1.1".parse().unwrap()));
        assert!(!private_address("8.8.8.8".parse().unwrap()));
        assert!(participant(&json!({"kind":"hello",
            "from":"00000000-0000-4000-8000-000000000001",
            "target":"00000000-0000-4000-8000-000000000002"})).is_some());
        assert!(participant(&json!({"kind":"unknown","from":"a","target":"b"})).is_none());
    }
}
