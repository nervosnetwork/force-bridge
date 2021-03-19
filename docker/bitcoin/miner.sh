#!/bin/bash

BLOCKTIME=2

while true
do
  bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf generatetoaddress 1 "$1"
  sleep $BLOCKTIME
done