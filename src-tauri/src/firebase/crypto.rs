use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

pub fn random_id() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    native::random(&mut bytes)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub fn digest(bytes: &[u8]) -> Result<String, String> {
    Ok(hash(bytes)?.iter().map(|b| format!("{b:02x}")).collect())
}

pub use native::{hash, protect, unprotect};

#[cfg(windows)]
mod native {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct Blob {
        len: u32,
        data: *mut u8,
    }
    #[link(name = "bcrypt")]
    extern "system" {
        fn BCryptGenRandom(handle: *mut c_void, bytes: *mut u8, len: u32, flags: u32) -> i32;
        fn BCryptOpenAlgorithmProvider(
            handle: *mut *mut c_void,
            name: *const u16,
            provider: *const u16,
            flags: u32,
        ) -> i32;
        fn BCryptCloseAlgorithmProvider(handle: *mut c_void, flags: u32) -> i32;
        fn BCryptHash(
            handle: *mut c_void,
            secret: *const u8,
            secret_len: u32,
            input: *const u8,
            input_len: u32,
            output: *mut u8,
            output_len: u32,
        ) -> i32;
    }
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            input: *const Blob,
            description: *const u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
        fn CryptUnprotectData(
            input: *const Blob,
            description: *mut *mut u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }
    fn length(bytes: &[u8]) -> Result<u32, String> {
        bytes
            .len()
            .try_into()
            .map_err(|_| "Data is too large for Windows cryptography.".into())
    }
    pub fn random(bytes: &mut [u8]) -> Result<(), String> {
        let len = length(bytes)?;
        if unsafe { BCryptGenRandom(ptr::null_mut(), bytes.as_mut_ptr(), len, 2) } < 0 {
            return Err("Windows could not generate secure randomness.".into());
        }
        Ok(())
    }
    pub fn hash(bytes: &[u8]) -> Result<[u8; 32], String> {
        struct Algorithm(*mut c_void);
        impl Drop for Algorithm {
            fn drop(&mut self) {
                unsafe {
                    BCryptCloseAlgorithmProvider(self.0, 0);
                }
            }
        }
        let len = length(bytes)?;
        let mut handle = ptr::null_mut();
        let name: Vec<u16> = "SHA256\0".encode_utf16().collect();
        if unsafe { BCryptOpenAlgorithmProvider(&mut handle, name.as_ptr(), ptr::null(), 0) } < 0 {
            return Err("Windows SHA-256 is unavailable.".into());
        }
        let algorithm = Algorithm(handle);
        let mut result = [0u8; 32];
        if unsafe {
            BCryptHash(
                algorithm.0,
                ptr::null(),
                0,
                bytes.as_ptr(),
                len,
                result.as_mut_ptr(),
                32,
            )
        } < 0
        {
            return Err("Windows could not hash the backup.".into());
        }
        Ok(result)
    }
    fn transform(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
        let input = Blob {
            len: length(bytes)?,
            data: bytes.as_ptr() as *mut u8,
        };
        let mut output = Blob {
            len: 0,
            data: ptr::null_mut(),
        };
        // DPAPI binds credentials to the current Windows user; UI is forbidden in the worker.
        let ok = unsafe {
            if encrypt {
                CryptProtectData(
                    &input,
                    ptr::null(),
                    ptr::null(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    1,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &input,
                    ptr::null_mut(),
                    ptr::null(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    1,
                    &mut output,
                )
            }
        };
        if ok == 0 {
            return Err("Windows could not open/save the login session. Sign in again.".into());
        }
        let result =
            unsafe { std::slice::from_raw_parts(output.data, output.len as usize).to_vec() };
        unsafe {
            LocalFree(output.data.cast());
        }
        Ok(result)
    }
    pub fn protect(bytes: &[u8]) -> Result<Vec<u8>, String> {
        transform(bytes, true)
    }
    pub fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
        transform(bytes, false)
    }
}

#[cfg(not(windows))]
mod native {
    pub fn random(_: &mut [u8]) -> Result<(), String> {
        Err("Cloud login currently requires Windows.".into())
    }
    pub fn hash(_: &[u8]) -> Result<[u8; 32], String> {
        Err("Cloud backup currently requires Windows.".into())
    }
    pub fn protect(_: &[u8]) -> Result<Vec<u8>, String> {
        Err("Cloud login currently requires Windows.".into())
    }
    pub fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> {
        Err("Cloud login currently requires Windows.".into())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn windows_crypto_and_credentials() {
        assert_eq!(
            digest(b"abc").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_ne!(random_id().unwrap(), random_id().unwrap());
        let mut encrypted = protect(b"refresh-token").unwrap();
        assert_eq!(unprotect(&encrypted).unwrap(), b"refresh-token");
        encrypted[0] ^= 255;
        assert!(unprotect(&encrypted).is_err());
    }
}
