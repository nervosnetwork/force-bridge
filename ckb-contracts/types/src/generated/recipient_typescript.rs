// Generated by Molecule 0.7.0

use super::basic::*;
use molecule::prelude::*;
#[derive(Clone)]
pub struct RecipientCellData(molecule::bytes::Bytes);
impl ::core::fmt::LowerHex for RecipientCellData {
    fn fmt(&self, f: &mut ::core::fmt::Formatter) -> ::core::fmt::Result {
        use molecule::hex_string;
        if f.alternate() {
            write!(f, "0x")?;
        }
        write!(f, "{}", hex_string(self.as_slice()))
    }
}
impl ::core::fmt::Debug for RecipientCellData {
    fn fmt(&self, f: &mut ::core::fmt::Formatter) -> ::core::fmt::Result {
        write!(f, "{}({:#x})", Self::NAME, self)
    }
}
impl ::core::fmt::Display for RecipientCellData {
    fn fmt(&self, f: &mut ::core::fmt::Formatter) -> ::core::fmt::Result {
        write!(f, "{} {{ ", Self::NAME)?;
        write!(f, "{}: {}", "recipient_address", self.recipient_address())?;
        write!(f, ", {}: {}", "chain", self.chain())?;
        write!(f, ", {}: {}", "asset", self.asset())?;
        write!(
            f,
            ", {}: {}",
            "bridge_lock_code_hash",
            self.bridge_lock_code_hash()
        )?;
        write!(f, ", {}: {}", "owner_lock_hash", self.owner_lock_hash())?;
        write!(f, ", {}: {}", "amount", self.amount())?;
        write!(f, ", {}: {}", "fee", self.fee())?;
        let extra_count = self.count_extra_fields();
        if extra_count != 0 {
            write!(f, ", .. ({} fields)", extra_count)?;
        }
        write!(f, " }}")
    }
}
impl ::core::default::Default for RecipientCellData {
    fn default() -> Self {
        let v: Vec<u8> = vec![
            137, 0, 0, 0, 32, 0, 0, 0, 36, 0, 0, 0, 37, 0, 0, 0, 41, 0, 0, 0, 73, 0, 0, 0, 105, 0,
            0, 0, 121, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        RecipientCellData::new_unchecked(v.into())
    }
}
impl RecipientCellData {
    pub const FIELD_COUNT: usize = 7;
    pub fn total_size(&self) -> usize {
        molecule::unpack_number(self.as_slice()) as usize
    }
    pub fn field_count(&self) -> usize {
        if self.total_size() == molecule::NUMBER_SIZE {
            0
        } else {
            (molecule::unpack_number(&self.as_slice()[molecule::NUMBER_SIZE..]) as usize / 4) - 1
        }
    }
    pub fn count_extra_fields(&self) -> usize {
        self.field_count() - Self::FIELD_COUNT
    }
    pub fn has_extra_fields(&self) -> bool {
        Self::FIELD_COUNT != self.field_count()
    }
    pub fn recipient_address(&self) -> Bytes {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[4..]) as usize;
        let end = molecule::unpack_number(&slice[8..]) as usize;
        Bytes::new_unchecked(self.0.slice(start..end))
    }
    pub fn chain(&self) -> Byte {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[8..]) as usize;
        let end = molecule::unpack_number(&slice[12..]) as usize;
        Byte::new_unchecked(self.0.slice(start..end))
    }
    pub fn asset(&self) -> Bytes {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[12..]) as usize;
        let end = molecule::unpack_number(&slice[16..]) as usize;
        Bytes::new_unchecked(self.0.slice(start..end))
    }
    pub fn bridge_lock_code_hash(&self) -> Byte32 {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[16..]) as usize;
        let end = molecule::unpack_number(&slice[20..]) as usize;
        Byte32::new_unchecked(self.0.slice(start..end))
    }
    pub fn owner_lock_hash(&self) -> Byte32 {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[20..]) as usize;
        let end = molecule::unpack_number(&slice[24..]) as usize;
        Byte32::new_unchecked(self.0.slice(start..end))
    }
    pub fn amount(&self) -> Uint128 {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[24..]) as usize;
        let end = molecule::unpack_number(&slice[28..]) as usize;
        Uint128::new_unchecked(self.0.slice(start..end))
    }
    pub fn fee(&self) -> Uint128 {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[28..]) as usize;
        if self.has_extra_fields() {
            let end = molecule::unpack_number(&slice[32..]) as usize;
            Uint128::new_unchecked(self.0.slice(start..end))
        } else {
            Uint128::new_unchecked(self.0.slice(start..))
        }
    }
    pub fn as_reader<'r>(&'r self) -> RecipientCellDataReader<'r> {
        RecipientCellDataReader::new_unchecked(self.as_slice())
    }
}
impl molecule::prelude::Entity for RecipientCellData {
    type Builder = RecipientCellDataBuilder;
    const NAME: &'static str = "RecipientCellData";
    fn new_unchecked(data: molecule::bytes::Bytes) -> Self {
        RecipientCellData(data)
    }
    fn as_bytes(&self) -> molecule::bytes::Bytes {
        self.0.clone()
    }
    fn as_slice(&self) -> &[u8] {
        &self.0[..]
    }
    fn from_slice(slice: &[u8]) -> molecule::error::VerificationResult<Self> {
        RecipientCellDataReader::from_slice(slice).map(|reader| reader.to_entity())
    }
    fn from_compatible_slice(slice: &[u8]) -> molecule::error::VerificationResult<Self> {
        RecipientCellDataReader::from_compatible_slice(slice).map(|reader| reader.to_entity())
    }
    fn new_builder() -> Self::Builder {
        ::core::default::Default::default()
    }
    fn as_builder(self) -> Self::Builder {
        Self::new_builder()
            .recipient_address(self.recipient_address())
            .chain(self.chain())
            .asset(self.asset())
            .bridge_lock_code_hash(self.bridge_lock_code_hash())
            .owner_lock_hash(self.owner_lock_hash())
            .amount(self.amount())
            .fee(self.fee())
    }
}
#[derive(Clone, Copy)]
pub struct RecipientCellDataReader<'r>(&'r [u8]);
impl<'r> ::core::fmt::LowerHex for RecipientCellDataReader<'r> {
    fn fmt(&self, f: &mut ::core::fmt::Formatter) -> ::core::fmt::Result {
        use molecule::hex_string;
        if f.alternate() {
            write!(f, "0x")?;
        }
        write!(f, "{}", hex_string(self.as_slice()))
    }
}
impl<'r> ::core::fmt::Debug for RecipientCellDataReader<'r> {
    fn fmt(&self, f: &mut ::core::fmt::Formatter) -> ::core::fmt::Result {
        write!(f, "{}({:#x})", Self::NAME, self)
    }
}
impl<'r> ::core::fmt::Display for RecipientCellDataReader<'r> {
    fn fmt(&self, f: &mut ::core::fmt::Formatter) -> ::core::fmt::Result {
        write!(f, "{} {{ ", Self::NAME)?;
        write!(f, "{}: {}", "recipient_address", self.recipient_address())?;
        write!(f, ", {}: {}", "chain", self.chain())?;
        write!(f, ", {}: {}", "asset", self.asset())?;
        write!(
            f,
            ", {}: {}",
            "bridge_lock_code_hash",
            self.bridge_lock_code_hash()
        )?;
        write!(f, ", {}: {}", "owner_lock_hash", self.owner_lock_hash())?;
        write!(f, ", {}: {}", "amount", self.amount())?;
        write!(f, ", {}: {}", "fee", self.fee())?;
        let extra_count = self.count_extra_fields();
        if extra_count != 0 {
            write!(f, ", .. ({} fields)", extra_count)?;
        }
        write!(f, " }}")
    }
}
impl<'r> RecipientCellDataReader<'r> {
    pub const FIELD_COUNT: usize = 7;
    pub fn total_size(&self) -> usize {
        molecule::unpack_number(self.as_slice()) as usize
    }
    pub fn field_count(&self) -> usize {
        if self.total_size() == molecule::NUMBER_SIZE {
            0
        } else {
            (molecule::unpack_number(&self.as_slice()[molecule::NUMBER_SIZE..]) as usize / 4) - 1
        }
    }
    pub fn count_extra_fields(&self) -> usize {
        self.field_count() - Self::FIELD_COUNT
    }
    pub fn has_extra_fields(&self) -> bool {
        Self::FIELD_COUNT != self.field_count()
    }
    pub fn recipient_address(&self) -> BytesReader<'r> {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[4..]) as usize;
        let end = molecule::unpack_number(&slice[8..]) as usize;
        BytesReader::new_unchecked(&self.as_slice()[start..end])
    }
    pub fn chain(&self) -> ByteReader<'r> {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[8..]) as usize;
        let end = molecule::unpack_number(&slice[12..]) as usize;
        ByteReader::new_unchecked(&self.as_slice()[start..end])
    }
    pub fn asset(&self) -> BytesReader<'r> {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[12..]) as usize;
        let end = molecule::unpack_number(&slice[16..]) as usize;
        BytesReader::new_unchecked(&self.as_slice()[start..end])
    }
    pub fn bridge_lock_code_hash(&self) -> Byte32Reader<'r> {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[16..]) as usize;
        let end = molecule::unpack_number(&slice[20..]) as usize;
        Byte32Reader::new_unchecked(&self.as_slice()[start..end])
    }
    pub fn owner_lock_hash(&self) -> Byte32Reader<'r> {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[20..]) as usize;
        let end = molecule::unpack_number(&slice[24..]) as usize;
        Byte32Reader::new_unchecked(&self.as_slice()[start..end])
    }
    pub fn amount(&self) -> Uint128Reader<'r> {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[24..]) as usize;
        let end = molecule::unpack_number(&slice[28..]) as usize;
        Uint128Reader::new_unchecked(&self.as_slice()[start..end])
    }
    pub fn fee(&self) -> Uint128Reader<'r> {
        let slice = self.as_slice();
        let start = molecule::unpack_number(&slice[28..]) as usize;
        if self.has_extra_fields() {
            let end = molecule::unpack_number(&slice[32..]) as usize;
            Uint128Reader::new_unchecked(&self.as_slice()[start..end])
        } else {
            Uint128Reader::new_unchecked(&self.as_slice()[start..])
        }
    }
}
impl<'r> molecule::prelude::Reader<'r> for RecipientCellDataReader<'r> {
    type Entity = RecipientCellData;
    const NAME: &'static str = "RecipientCellDataReader";
    fn to_entity(&self) -> Self::Entity {
        Self::Entity::new_unchecked(self.as_slice().to_owned().into())
    }
    fn new_unchecked(slice: &'r [u8]) -> Self {
        RecipientCellDataReader(slice)
    }
    fn as_slice(&self) -> &'r [u8] {
        self.0
    }
    fn verify(slice: &[u8], compatible: bool) -> molecule::error::VerificationResult<()> {
        use molecule::verification_error as ve;
        let slice_len = slice.len();
        if slice_len < molecule::NUMBER_SIZE {
            return ve!(Self, HeaderIsBroken, molecule::NUMBER_SIZE, slice_len);
        }
        let total_size = molecule::unpack_number(slice) as usize;
        if slice_len != total_size {
            return ve!(Self, TotalSizeNotMatch, total_size, slice_len);
        }
        if slice_len == molecule::NUMBER_SIZE && Self::FIELD_COUNT == 0 {
            return Ok(());
        }
        if slice_len < molecule::NUMBER_SIZE * 2 {
            return ve!(Self, HeaderIsBroken, molecule::NUMBER_SIZE * 2, slice_len);
        }
        let offset_first = molecule::unpack_number(&slice[molecule::NUMBER_SIZE..]) as usize;
        if offset_first % molecule::NUMBER_SIZE != 0 || offset_first < molecule::NUMBER_SIZE * 2 {
            return ve!(Self, OffsetsNotMatch);
        }
        if slice_len < offset_first {
            return ve!(Self, HeaderIsBroken, offset_first, slice_len);
        }
        let field_count = offset_first / molecule::NUMBER_SIZE - 1;
        if field_count < Self::FIELD_COUNT {
            return ve!(Self, FieldCountNotMatch, Self::FIELD_COUNT, field_count);
        } else if !compatible && field_count > Self::FIELD_COUNT {
            return ve!(Self, FieldCountNotMatch, Self::FIELD_COUNT, field_count);
        };
        let mut offsets: Vec<usize> = slice[molecule::NUMBER_SIZE..offset_first]
            .chunks_exact(molecule::NUMBER_SIZE)
            .map(|x| molecule::unpack_number(x) as usize)
            .collect();
        offsets.push(total_size);
        if offsets.windows(2).any(|i| i[0] > i[1]) {
            return ve!(Self, OffsetsNotMatch);
        }
        BytesReader::verify(&slice[offsets[0]..offsets[1]], compatible)?;
        ByteReader::verify(&slice[offsets[1]..offsets[2]], compatible)?;
        BytesReader::verify(&slice[offsets[2]..offsets[3]], compatible)?;
        Byte32Reader::verify(&slice[offsets[3]..offsets[4]], compatible)?;
        Byte32Reader::verify(&slice[offsets[4]..offsets[5]], compatible)?;
        Uint128Reader::verify(&slice[offsets[5]..offsets[6]], compatible)?;
        Uint128Reader::verify(&slice[offsets[6]..offsets[7]], compatible)?;
        Ok(())
    }
}
#[derive(Debug, Default)]
pub struct RecipientCellDataBuilder {
    pub(crate) recipient_address: Bytes,
    pub(crate) chain: Byte,
    pub(crate) asset: Bytes,
    pub(crate) bridge_lock_code_hash: Byte32,
    pub(crate) owner_lock_hash: Byte32,
    pub(crate) amount: Uint128,
    pub(crate) fee: Uint128,
}
impl RecipientCellDataBuilder {
    pub const FIELD_COUNT: usize = 7;
    pub fn recipient_address(mut self, v: Bytes) -> Self {
        self.recipient_address = v;
        self
    }
    pub fn chain(mut self, v: Byte) -> Self {
        self.chain = v;
        self
    }
    pub fn asset(mut self, v: Bytes) -> Self {
        self.asset = v;
        self
    }
    pub fn bridge_lock_code_hash(mut self, v: Byte32) -> Self {
        self.bridge_lock_code_hash = v;
        self
    }
    pub fn owner_lock_hash(mut self, v: Byte32) -> Self {
        self.owner_lock_hash = v;
        self
    }
    pub fn amount(mut self, v: Uint128) -> Self {
        self.amount = v;
        self
    }
    pub fn fee(mut self, v: Uint128) -> Self {
        self.fee = v;
        self
    }
}
impl molecule::prelude::Builder for RecipientCellDataBuilder {
    type Entity = RecipientCellData;
    const NAME: &'static str = "RecipientCellDataBuilder";
    fn expected_length(&self) -> usize {
        molecule::NUMBER_SIZE * (Self::FIELD_COUNT + 1)
            + self.recipient_address.as_slice().len()
            + self.chain.as_slice().len()
            + self.asset.as_slice().len()
            + self.bridge_lock_code_hash.as_slice().len()
            + self.owner_lock_hash.as_slice().len()
            + self.amount.as_slice().len()
            + self.fee.as_slice().len()
    }
    fn write<W: ::molecule::io::Write>(&self, writer: &mut W) -> ::molecule::io::Result<()> {
        let mut total_size = molecule::NUMBER_SIZE * (Self::FIELD_COUNT + 1);
        let mut offsets = Vec::with_capacity(Self::FIELD_COUNT);
        offsets.push(total_size);
        total_size += self.recipient_address.as_slice().len();
        offsets.push(total_size);
        total_size += self.chain.as_slice().len();
        offsets.push(total_size);
        total_size += self.asset.as_slice().len();
        offsets.push(total_size);
        total_size += self.bridge_lock_code_hash.as_slice().len();
        offsets.push(total_size);
        total_size += self.owner_lock_hash.as_slice().len();
        offsets.push(total_size);
        total_size += self.amount.as_slice().len();
        offsets.push(total_size);
        total_size += self.fee.as_slice().len();
        writer.write_all(&molecule::pack_number(total_size as molecule::Number))?;
        for offset in offsets.into_iter() {
            writer.write_all(&molecule::pack_number(offset as molecule::Number))?;
        }
        writer.write_all(self.recipient_address.as_slice())?;
        writer.write_all(self.chain.as_slice())?;
        writer.write_all(self.asset.as_slice())?;
        writer.write_all(self.bridge_lock_code_hash.as_slice())?;
        writer.write_all(self.owner_lock_hash.as_slice())?;
        writer.write_all(self.amount.as_slice())?;
        writer.write_all(self.fee.as_slice())?;
        Ok(())
    }
    fn build(&self) -> Self::Entity {
        let mut inner = Vec::with_capacity(self.expected_length());
        self.write(&mut inner)
            .unwrap_or_else(|_| panic!("{} build should be ok", Self::NAME));
        RecipientCellData::new_unchecked(inner.into())
    }
}
