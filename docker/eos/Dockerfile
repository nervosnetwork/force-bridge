FROM ubuntu:18.04

RUN apt-get update && apt-get install -y curl libicu60 libusb-1.0-0 libcurl3-gnutls git cmake g++ nodejs npm nano

# Install EOSIO
RUN curl -LO https://github.com/EOSIO/eos/releases/download/v2.0.11/eosio_2.0.11-1-ubuntu-18.04_amd64.deb \
    && dpkg -i eosio_2.0.11-1-ubuntu-18.04_amd64.deb

# Download and unpackage EOSIO.CDT 1.6.3
RUN curl -o /eosio.cdt/eosio.cdt_1.6.3-1-ubuntu-18.04_amd64.deb --create-dirs -L https://github.com/EOSIO/eosio.cdt/releases/download/v1.6.3/eosio.cdt_1.6.3-1-ubuntu-18.04_amd64.deb \
    && dpkg-deb -x /eosio.cdt/eosio.cdt_1.6.3-1-ubuntu-18.04_amd64.deb /eosio.cdt/v1.6.3

# Download EOSIO.Contracts
RUN curl -LO https://github.com/EOSIO/eosio.contracts/archive/v1.8.3.tar.gz && tar -xzvf v1.8.3.tar.gz --one-top-level=eosio.contracts --strip-components 1

# Activate EOSIO.CDT 1.6.3
RUN cp -rf /eosio.cdt/v1.6.3/usr/* /usr/

# Build EOSIO.Contracts
RUN cd /eosio.contracts/ && mkdir build && cd build && cmake .. && make all

COPY config.ini ./
COPY genesis.json ./
COPY entrypoint.sh ./

ENTRYPOINT ["./entrypoint.sh"]
