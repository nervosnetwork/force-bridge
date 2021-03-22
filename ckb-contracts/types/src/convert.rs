#[cfg(not(feature = "std"))]
use alloc::borrow::ToOwned;
#[cfg(not(feature = "std"))]
use alloc::string::String;
#[cfg(not(feature = "std"))]
use alloc::vec::Vec;

use crate::generated::basic::{Byte32, Bytes, Uint128};
use core::convert::TryFrom;
use molecule::{
    error::VerificationError,
    prelude::{Builder, Byte, Entity},
};

impl From<Vec<u8>> for Bytes {
    fn from(v: Vec<u8>) -> Self {
        Bytes::new_builder()
            .set(v.into_iter().map(Byte::new).collect())
            .build()
    }
}

impl TryFrom<Vec<u8>> for Byte32 {
    type Error = VerificationError;
    fn try_from(v: Vec<u8>) -> Result<Self, VerificationError> {
        if v.len() != 32 {
            return Err(VerificationError::TotalSizeNotMatch(
                "Byte32".to_owned(),
                32,
                v.len(),
            ));
        }
        let mut inner = [Byte::new(0); 32];
        let v = v.into_iter().map(Byte::new).collect::<Vec<_>>();
        inner.copy_from_slice(&v);
        Ok(Self::new_builder().set(inner).build())
    }
}

impl From<u128> for Uint128 {
    fn from(v: u128) -> Self {
        let mut inner = [Byte::new(0); 16];
        let v = v
            .to_le_bytes()
            .to_vec()
            .into_iter()
            .map(Byte::new)
            .collect::<Vec<_>>();
        inner.copy_from_slice(&v);
        Self::new_builder().set(inner).build()
    }
}

impl From<String> for Bytes {
    fn from(s: String) -> Self {
        Bytes::new_builder()
            .set(
                s.as_str()
                    .as_bytes()
                    .iter()
                    .map(|c| Byte::new(*c))
                    .collect::<Vec<_>>(),
            )
            .build()
    }
}

impl From<Bytes> for String {
    fn from(b: Bytes) -> Self {
        String::from_utf8(b.raw_data().as_ref().to_vec()).expect("Bytes to string error")
    }
}
