SCHEMA_PATH := schemas
SCHEMA_DEST_PATH := src/generated

schema:
	moleculec --language rust --schema-file ${SCHEMA_PATH}/basic.mol > ${SCHEMA_DEST_PATH}/basic.rs
	moleculec --language rust --schema-file ${SCHEMA_PATH}/witness.mol > ${SCHEMA_DEST_PATH}/witness.rs
	moleculec --language rust --schema-file ${SCHEMA_PATH}/eth_header_cell.mol > ${SCHEMA_DEST_PATH}/eth_header_cell.rs
	moleculec --language rust --schema-file ${SCHEMA_PATH}/eth_recipient_cell.mol > ${SCHEMA_DEST_PATH}/eth_recipient_cell.rs
	moleculec --language rust --schema-file ${SCHEMA_PATH}/eth_bridge_lock_cell.mol > ${SCHEMA_DEST_PATH}/eth_bridge_lock_cell.rs
	moleculec --language rust --schema-file ${SCHEMA_PATH}/eth_bridge_type_cell.mol > ${SCHEMA_DEST_PATH}/eth_bridge_type_cell.rs
	cargo fmt
