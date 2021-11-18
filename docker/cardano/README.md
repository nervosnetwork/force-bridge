# Cardano docker scripts

## Basic Testnet

This creates a testnet with three nodes and a user account with all the funds.
It also runs a custom version of cardano-wallet server, accessible via port 8190,
which includes the features needed by the force-bridge collector and
verifier operators.

```
docker-compose build
docker-compose up
```

Since the cardano-cli and cardano-wallet need the socket file of the
cardano-node to work. This test setup exposes the socket files of the three
nodes in the node-sockets dir. This allows running these tools outside the
docker for testing purposes.

```
ls node-sockets/
node-bft1.sock  node-bft2.sock  node-pool1.sock
```
