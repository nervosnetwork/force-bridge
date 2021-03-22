SCHEMA_PATH := schemas
SCHEMA_DEST_PATH := src/generated

schema:
	moleculec --language rust --schema-file ${SCHEMA_PATH}/basic.mol > ${SCHEMA_DEST_PATH}/basic.rs
	moleculec --language rust --schema-file ${SCHEMA_PATH}/force_bridge_lockscript.mol > ${SCHEMA_DEST_PATH}/force_bridge_lockscript.rs
	moleculec --language rust --schema-file ${SCHEMA_PATH}/recipient_typescript.mol > ${SCHEMA_DEST_PATH}/recipient_typescript.rs
	cargo fmt
