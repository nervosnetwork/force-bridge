
local-ci: clean-dev-env install-node-modules github-ci


github-ci: build-ckb-contracts start-docker
	cd offchain-modules && cp config.json.example config.json
	make deploy-eth-contracts
	cd offchain-modules && yarn ci

install-node-modules:
	cd offchain-modules && yarn --frozen-lockfile
	cd eth-contracts && yarn --frozen-lockfile

start-docker:
	cd docker && docker-compose up -d

stop-docker:
	cd docker && docker-compose down

build-ckb-contracts:
	cd ckb-contracts && capsule build --release

deploy-eth-contracts:
	cd eth-contracts && yarn ci

clean-dev-env: stop-docker

start-multisig-server-docker:
	cd  offchain-modules/packages/app-multisign-server/docker && docker-compose up -d
