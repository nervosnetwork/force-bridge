use crate::generated::recipient_typescript::{RecipientCellData, RecipientCellDataReader};
use core::convert::TryInto;
use core::result::Result;
use molecule::{
    bytes::Bytes,
    error::VerificationError,
    prelude::{Builder, Entity, Reader},
};

#[cfg(not(feature = "std"))]
use alloc::string::String;

#[derive(Debug, Clone)]
pub struct RecipientDataView {
    pub recipient_address: String,
    pub chain: u8,
    pub asset: String,
    pub bridge_lock_code_hash: [u8; 32],
    pub bridge_lock_hash_type: u8,
    pub owner_lock_hash: [u8; 32],
    pub amount: u128,
    pub fee: u128,
}

impl RecipientDataView {
    pub fn new(data: &[u8]) -> Result<RecipientDataView, VerificationError> {
        RecipientCellDataReader::verify(data, false)?;
        let data_reader = RecipientCellDataReader::new_unchecked(data);

        let recipient_address = data_reader.recipient_address().to_entity().into();
        let chain = data_reader.chain().to_entity().into();
        let asset = data_reader.asset().to_entity().into();

        let mut bridge_lock_code_hash = [0u8; 32];
        bridge_lock_code_hash.copy_from_slice(data_reader.bridge_lock_code_hash().raw_data());

        let bridge_lock_hash_type = data_reader.bridge_lock_hash_type().to_entity().into();

        let mut owner_lock_hash = [0u8; 32];
        owner_lock_hash.copy_from_slice(data_reader.owner_lock_hash().raw_data());

        let mut amount = [0u8; 16];
        amount.copy_from_slice(data_reader.amount().raw_data());
        let amount: u128 = u128::from_le_bytes(amount);

        let mut fee = [0u8; 16];
        fee.copy_from_slice(data_reader.fee().raw_data());
        let fee: u128 = u128::from_le_bytes(fee);

        Ok(RecipientDataView {
            recipient_address,
            chain,
            asset,
            bridge_lock_code_hash,
            bridge_lock_hash_type,
            owner_lock_hash,
            amount,
            fee,
        })
    }

    pub fn as_molecule_data(&self) -> Result<Bytes, VerificationError> {
        let mol_obj = RecipientCellData::new_builder()
            .recipient_address(self.recipient_address.clone().into())
            .asset(self.asset.clone().into())
            .chain(self.chain.into())
            .owner_lock_hash(
                self.owner_lock_hash
                    .to_vec()
                    .try_into()
                    .expect("owner_lock_hash convert fail"),
            )
            .bridge_lock_code_hash(
                self.bridge_lock_code_hash
                    .to_vec()
                    .try_into()
                    .expect("bridge_lock_code_hash convert fail"),
            )
            .bridge_lock_hash_type(self.bridge_lock_hash_type.into())
            .amount(self.amount.into())
            .fee(self.fee.into())
            .build();
        Ok(mol_obj.as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::RecipientDataView;

    #[test]
    fn test_eth_recipient_data() {
        let eth_recipient_data = RecipientDataView {
            recipient_address: "TX3MGfWT5aGv81vTSdZtr6hbHxhMVh1FFM".to_string(),
            chain: 1,
            asset: "TRC".to_string(),
            bridge_lock_code_hash: [1u8; 32],
            bridge_lock_hash_type: 0,
            owner_lock_hash: [2u8; 32],
            amount: 100,
            fee: 100,
        };
        let mol_data = eth_recipient_data.as_molecule_data().unwrap();
        let new_eth_recipient_data = RecipientDataView::new(mol_data.as_ref()).unwrap();

        assert_eq!(
            eth_recipient_data.recipient_address,
            new_eth_recipient_data.recipient_address
        );
        assert_eq!(eth_recipient_data.chain, new_eth_recipient_data.chain);
        assert_eq!(eth_recipient_data.asset, new_eth_recipient_data.asset);
        assert_eq!(
            eth_recipient_data.bridge_lock_code_hash,
            new_eth_recipient_data.bridge_lock_code_hash
        );
        assert_eq!(
            eth_recipient_data.bridge_lock_hash_type,
            new_eth_recipient_data.bridge_lock_hash_type
        );
        assert_eq!(
            eth_recipient_data.owner_lock_hash,
            new_eth_recipient_data.owner_lock_hash
        );
        assert_eq!(eth_recipient_data.amount, new_eth_recipient_data.amount);
        assert_eq!(eth_recipient_data.fee, new_eth_recipient_data.fee);
    }
}
