//! Per-user, non-exportable P-256 identities in Windows CNG's persisted key store.
//! The CNG key name is scoped to a stable device UUID; private key bytes never enter JS.
use serde::Serialize;
use std::ffi::c_void;
use std::ptr;

#[link(name = "ncrypt")]
extern "system" {
    fn NCryptOpenStorageProvider(out: *mut usize, name: *const u16, flags: u32) -> i32;
    fn NCryptOpenKey(provider: usize, out: *mut usize, name: *const u16, legacy: u32, flags: u32) -> i32;
    fn NCryptCreatePersistedKey(provider: usize, out: *mut usize, algorithm: *const u16, name: *const u16, legacy: u32, flags: u32) -> i32;
    fn NCryptFinalizeKey(key: usize, flags: u32) -> i32;
    fn NCryptExportKey(key: usize, export_key: usize, kind: *const u16, params: *const c_void, output: *mut u8, capacity: u32, actual: *mut u32, flags: u32) -> i32;
    fn NCryptSignHash(key: usize, padding: *const c_void, hash: *const u8, hash_len: u32, signature: *mut u8, sig_capacity: u32, actual: *mut u32, flags: u32) -> i32;
    fn NCryptFreeObject(handle: usize) -> i32;
}
#[link(name = "bcrypt")]
extern "system" {
    fn BCryptOpenAlgorithmProvider(out: *mut usize, algorithm: *const u16, implementation: *const u16, flags: u32) -> i32;
    fn BCryptHash(algorithm: usize, secret: *const u8, secret_len: u32, input: *const u8, input_len: u32, digest: *mut u8, digest_len: u32) -> i32;
    fn BCryptCloseAlgorithmProvider(algorithm: usize, flags: u32) -> i32;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

struct CngObject(usize);
impl Drop for CngObject {
    fn drop(&mut self) { if self.0 != 0 { unsafe { NCryptFreeObject(self.0); } } }
}
struct HashAlgorithm(usize);
impl Drop for HashAlgorithm {
    fn drop(&mut self) { if self.0 != 0 { unsafe { BCryptCloseAlgorithmProvider(self.0, 0); } } }
}
fn ok(status: i32) -> Result<(), String> {
    if status == 0 { Ok(()) } else { Err(format!("Windows key operation failed (0x{:08X}).", status as u32)) }
}
fn key_name(id: &str) -> Result<String, String> {
    let valid = id.len() == 36 && id.bytes().enumerate().all(|(i, b)| {
        if [8,13,18,23].contains(&i) { b == b'-' } else { b.is_ascii_hexdigit() }
    });
    if !valid { return Err("Invalid device identifier.".into()); }
    Ok(format!("personal-voice-pair-v1-{}", id.to_lowercase()))
}
fn open_key(device_id: &str) -> Result<(CngObject, CngObject), String> {
    let mut prov = 0;
    ok(unsafe { NCryptOpenStorageProvider(&mut prov, wide("Microsoft Software Key Storage Provider").as_ptr(), 0) })?;
    let provider = CngObject(prov);
    let name = wide(&key_name(device_id)?);
    let mut handle = 0;
    if unsafe { NCryptOpenKey(provider.0, &mut handle, name.as_ptr(), 0, 0) } != 0 {
        // Never overwrite an existing persisted identity.
        ok(unsafe {
            NCryptCreatePersistedKey(provider.0, &mut handle, wide("ECDSA_P256").as_ptr(), name.as_ptr(), 0, 0)
        })?;
        let new_key = CngObject(handle);
        ok(unsafe { NCryptFinalizeKey(new_key.0, 0) })?;
        return Ok((provider, new_key));
    }
    Ok((provider, CngObject(handle)))
}
fn to_base64_url(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity((bytes.len() * 4 + 2) / 3);
    for block in bytes.chunks(3) {
        let a = block[0] as usize;
        let b = block.get(1).copied().unwrap_or(0) as usize;
        let c = block.get(2).copied().unwrap_or(0) as usize;
        output.push(TABLE[a >> 2] as char);
        output.push(TABLE[((a & 3) << 4) | (b >> 4)] as char);
        if block.len() > 1 { output.push(TABLE[((b & 15) << 2) | (c >> 6)] as char); }
        if block.len() > 2 { output.push(TABLE[c & 63] as char); }
    }
    output
}

#[derive(Serialize)]
pub struct PairPublicKey {
    kty: &'static str,
    crv: &'static str,
    x: String,
    y: String,
}

pub fn public_key(device_id: &str) -> Result<PairPublicKey, String> {
    let (_provider, key) = open_key(device_id)?;
    let kind = wide("ECCPUBLICBLOB");
    let mut length = 0u32;
    ok(unsafe { NCryptExportKey(key.0, 0, kind.as_ptr(), ptr::null(), ptr::null_mut(), 0, &mut length, 0) })?;
    if length != 72 { return Err("Unexpected P-256 key format.".into()); }
    let mut blob = vec![0u8; length as usize];
    ok(unsafe { NCryptExportKey(key.0, 0, kind.as_ptr(), ptr::null(), blob.as_mut_ptr(), length, &mut length, 0) })?;
    // BCRYPT_ECCPUBLIC_BLOB header: ECDSA P-256 magic ECS1, coordinate size 32.
    if length != 72 || u32::from_le_bytes(blob[0..4].try_into().unwrap()) != 0x31534345
        || u32::from_le_bytes(blob[4..8].try_into().unwrap()) != 32 {
        return Err("Unexpected P-256 public key blob.".into());
    }
    Ok(PairPublicKey { kty: "EC", crv: "P-256",
        x: to_base64_url(&blob[8..40]), y: to_base64_url(&blob[40..72]) })
}

pub fn sign(device_id: &str, message: &str) -> Result<String, String> {
    if message.len() > 2048 { return Err("Pairing message is too large.".into()); }
    let (_provider, key) = open_key(device_id)?;
    let mut algorithm = 0;
    ok(unsafe { BCryptOpenAlgorithmProvider(&mut algorithm, wide("SHA256").as_ptr(), ptr::null(), 0) })?;
    let algorithm = HashAlgorithm(algorithm);
    let mut digest = [0u8; 32];
    ok(unsafe { BCryptHash(algorithm.0, ptr::null(), 0, message.as_ptr(), message.len() as u32, digest.as_mut_ptr(), 32) })?;
    let mut length = 0u32;
    ok(unsafe { NCryptSignHash(key.0, ptr::null(), digest.as_ptr(), 32, ptr::null_mut(), 0, &mut length, 0) })?;
    if length != 64 { return Err("Unexpected ECDSA signature size.".into()); }
    let mut signature = [0u8; 64];
    ok(unsafe { NCryptSignHash(key.0, ptr::null(), digest.as_ptr(), 32, signature.as_mut_ptr(), 64, &mut length, 0) })?;
    if length != 64 { return Err("Unexpected ECDSA signature.".into()); }
    Ok(to_base64_url(&signature))
}

#[cfg(test)]
mod tests {
    use super::{key_name, to_base64_url};
    #[test]
    fn base64_url_known_vectors() {
        assert_eq!(to_base64_url(b""), "");
        assert_eq!(to_base64_url(b"f"), "Zg");
        assert_eq!(to_base64_url(b"fo"), "Zm8");
        assert_eq!(to_base64_url(b"foo"), "Zm9v");
    }
    #[test]
    fn no_untrusted_key_names() {
        assert!(key_name("00000000-0000-4000-8000-000000000001").is_ok());
        assert!(key_name("../other").is_err());
    }
}
