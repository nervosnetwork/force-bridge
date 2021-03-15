
local-ci: clean-dev-env github-ci

github-ci: build-ckb-contracts start-docker
	cd offchain-modules && cp config.json.example config.json
	make deploy-eth-contracts
	cd offchain-modules && yarn && yarn ci

start-docker:
	cd docker && docker-compose up -d

stop-docker:
	cd docker && docker-compose down

build-ckb-contracts:
	cd ckb-contracts && capsule build --release

deploy-eth-contracts:
	cd eth-contracts && yarn && yarn deploy

clean-dev-env: stop-docker


